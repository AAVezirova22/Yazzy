import csv
import io
import time

from pydantic.alias_generators import to_camel
from sqlalchemy import select

from yazzy.infrastructure.models import (
    Baseline,
    Finding,
    Membership,
    Sample,
    SimulationRun,
    Trip,
    Vehicle,
)
from yazzy.modules.identity.policy import Context, vehicle, vehicle_scope
from yazzy.modules.trips.domain import aggregate, good_fix


def serialize(obj):
    return {
        to_camel(c.name): getattr(obj, c.name)
        for c in obj.__table__.columns
        if c.name not in {"token_hash", "payload_hash"}
    }


def overview(db, ctx):
    vehicles = list(
        db.scalars(vehicle_scope(select(Vehicle).where(Vehicle.archived.is_(False)), ctx))
    )
    results = []
    all_trips = []
    for v in vehicles:
        samples = list(
            db.scalars(
                select(Sample)
                .where(Sample.tenant_id == ctx.tenant_id, Sample.vehicle_id == v.id)
                .order_by(Sample.observed_at.desc())
                .limit(100)
            )
        )
        latest = {
            signal: next((s for s in samples if s.signal == signal and s.quality == "VALID"), None)
            for signal in ["VEHICLE_SPEED", "ENGINE_RPM", "GPS", "IGNITION"]
        }
        run_id = samples[0].run_id if samples else None
        run = db.get(SimulationRun, run_id) if run_id else None
        clock = run.virtual_now if run else time.time()
        last = samples[0] if samples else None
        age = max(0, clock - last.observed_at) if last else None
        speed, rpm, gps = latest["VEHICLE_SPEED"], latest["ENGINE_RPM"], latest["GPS"]
        speed = speed.value if speed and clock - speed.observed_at <= 30 else None
        rpm = rpm.value if rpm and clock - rpm.observed_at <= 30 else None
        ignition = latest["IGNITION"]
        parked = ignition is not None and ignition.value == 0 and clock - ignition.observed_at <= 30
        state = (
            "NO_DATA"
            if last is None
            else "OFFLINE"
            if age is not None and age > 60
            else "MOVING"
            if speed is not None and speed > 1
            else "IDLING"
            if rpm is not None and rpm > 0
            else "PARKED"
            if speed == 0 and parked
            else "STOPPED"
            if speed == 0
            else "UNKNOWN"
        )
        trips = list(
            db.scalars(select(Trip).where(Trip.tenant_id == ctx.tenant_id, Trip.vehicle_id == v.id))
        )
        findings = list(
            db.scalars(
                select(Finding).where(
                    Finding.tenant_id == ctx.tenant_id,
                    Finding.vehicle_id == v.id,
                    Finding.status != "RESOLVED",
                )
            )
        )
        baseline = db.scalar(
            select(Baseline).where(Baseline.tenant_id == ctx.tenant_id, Baseline.vehicle_id == v.id)
        )
        all_trips.extend(trips)
        position = None
        if gps and good_fix(gps.value):
            position = {
                **gps.value,
                "observedAt": gps.observed_at,
                "fresh": clock - gps.observed_at <= 30,
            }
        results.append(
            {
                **serialize(v),
                "state": state,
                "lastObservedAt": last.observed_at if last else None,
                "lastReceivedAt": max(s.received_at for s in samples) if samples else None,
                "position": position,
                "speed": speed,
                "findingCount": len(findings),
                "healthState": "CHANGE_DETECTED"
                if findings
                else baseline.status
                if baseline
                else "INSUFFICIENT_DATA",
                "baseline": baseline.data if baseline else None,
                "totals": aggregate(trips),
            }
        )
    return {
        "vehicles": results,
        "totals": aggregate(all_trips),
        "serverTime": time.time(),
        "simulationRuns": [
            serialize(r)
            for r in db.scalars(
                select(SimulationRun).where(
                    SimulationRun.tenant_id == ctx.tenant_id, SimulationRun.status != "RESET"
                )
            )
        ],
    }


def build_export(db, tenant_id, payload):
    member = db.scalar(
        select(Membership).where(
            Membership.subject == payload["actor"],
            Membership.tenant_id == tenant_id,
            Membership.active.is_(True),
        )
    )
    if not member:
        raise PermissionError("MEMBERSHIP_REVOKED")
    ctx = Context(tenant_id, member.subject, member.role, tuple(member.vehicle_ids))
    stream = io.StringIO()
    writer = csv.writer(stream)
    writer.writerow(
        [
            "vehicle",
            "origin",
            "start_utc_epoch",
            "end_utc_epoch",
            "status",
            "distance_km",
            "fuel_litres",
            "distance_method",
            "fuel_method",
            "fuel_coverage",
            "calculation_version",
        ]
    )
    count = 0
    for vehicle_id in payload["vehicleIds"]:
        v = vehicle(db, ctx, vehicle_id)
        query = select(Trip).where(Trip.tenant_id == tenant_id, Trip.vehicle_id == v.id)
        if payload.get("fromAt") is not None:
            query = query.where(Trip.start_at >= payload["fromAt"])
        if payload.get("toAt") is not None:
            query = query.where(Trip.start_at < payload["toAt"])
        for t in db.scalars(query.order_by(Trip.start_at).limit(5000)):
            # Spreadsheet formula injection protection for untrusted display names.
            name = "'" + v.name if v.name.startswith(("=", "+", "-", "@", "\t", "\r")) else v.name
            writer.writerow(
                [
                    name,
                    t.origin,
                    t.start_at,
                    t.end_at,
                    t.status,
                    t.metrics["distanceKm"],
                    t.metrics["fuelLitres"],
                    t.metrics["distanceMethod"],
                    t.metrics["fuelMethod"],
                    t.metrics["fuelCoverage"],
                    t.calculation_version,
                ]
            )
            count += 1
    return {
        "csv": stream.getvalue(),
        "rows": count,
        "dataOrigin": "PER_ROW",
        "filename": "yazzy-vehicle-report.csv",
    }
