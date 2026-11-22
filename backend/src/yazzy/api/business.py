"""The Business dashboard: every car in the Business group with its last drive, distances and whereabouts, and
where a car is right now while it is being driven."""

import time

from fastapi import APIRouter, Depends
from sqlalchemy import select

from yazzy.infrastructure.db import get_db
from yazzy.infrastructure.models import Sample, Trip, Vehicle
from yazzy.modules.identity.policy import authenticate, vehicle_scope

router = APIRouter(prefix="/api/v1/business")
LIVE_SECONDS = 120  # the phone uploads every few seconds while recording; older than this is not "now"
DAY = 86400


def latest(db, ctx, vehicle_id: str, signal: str, since: float):
    return db.scalar(
        select(Sample)
        .where(Sample.tenant_id == ctx.tenant_id, Sample.vehicle_id == vehicle_id, Sample.signal == signal,
               Sample.observed_at >= since)
        .order_by(Sample.observed_at.desc())
        .limit(1)
    )


def position_of(sample) -> dict | None:
    value = sample.value if sample else None
    if not isinstance(value, dict) or value.get("latitude") is None or value.get("longitude") is None:
        return None
    return {"latitude": value["latitude"], "longitude": value["longitude"], "accuracy": value.get("accuracy"),
            "at": sample.observed_at}


def last_point(trip) -> dict | None:
    route = (trip.metrics or {}).get("route") or [] if trip else []
    point = route[-1] if route else None
    if not point or point.get("latitude") is None:
        return None
    return {"latitude": point["latitude"], "longitude": point["longitude"], "accuracy": point.get("accuracy"),
            "at": point.get("time") or trip.end_at or trip.start_at}


def distance(trips, since: float) -> float:
    return round(sum((t.metrics or {}).get("distanceKm") or 0 for t in trips if t.start_at >= since), 1)


@router.get("/dashboard")
def dashboard(ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
    now = time.time()
    cars = list(db.scalars(
        vehicle_scope(select(Vehicle), ctx).where(Vehicle.archived.is_(False), Vehicle.category == "BUSINESS")
        .order_by(Vehicle.created_at)
    ))
    rows = []
    for v in cars:
        trips = list(db.scalars(
            select(Trip).where(Trip.tenant_id == ctx.tenant_id, Trip.vehicle_id == v.id, Trip.start_at >= now - 30 * DAY)
            .order_by(Trip.start_at.desc())
        ))
        last_trip = trips[0] if trips else db.scalar(
            select(Trip).where(Trip.tenant_id == ctx.tenant_id, Trip.vehicle_id == v.id)
            .order_by(Trip.start_at.desc()).limit(1)
        )
        speed = latest(db, ctx, v.id, "VEHICLE_SPEED", now - LIVE_SECONDS)
        rpm = latest(db, ctx, v.id, "ENGINE_RPM", now - LIVE_SECONDS)
        live = bool((speed and (speed.value or 0) > 1) or (rpm and (rpm.value or 0) > 0))
        gps = latest(db, ctx, v.id, "GPS", now - (LIVE_SECONDS if live else 30 * DAY))
        position = position_of(gps)
        parked = (v.profile or {}).get("parked") if isinstance(v.profile, dict) else None
        if not live:
            # Where it stands: the newest of its last GPS reading, its last trip's end and the phone's parked spot.
            spots = [p for p in (position, last_point(last_trip), parked if isinstance(parked, dict) else None) if p]
            spots = [p for p in spots if p.get("latitude") is not None]
            position = max(spots, key=lambda p: p.get("at") or 0) if spots else None
        rows.append({
            "id": v.id, "name": v.name, "make": v.make, "model": v.model, "year": v.year,
            "live": live, "speedKmh": round(speed.value) if live and speed and speed.value is not None else None,
            "position": position,
            "lastTrip": {"startAt": last_trip.start_at, "endAt": last_trip.end_at,
                         "distanceKm": (last_trip.metrics or {}).get("distanceKm")} if last_trip else None,
            "km7": distance(trips, now - 7 * DAY), "km30": distance(trips, now - 30 * DAY), "trips30": len(trips), "odometerKm": v.odometer_km,
        })
    driven = [r for r in rows if r["lastTrip"]]
    last = max(driven, key=lambda r: r["lastTrip"]["endAt"] or r["lastTrip"]["startAt"]) if driven else None
    return {
        "cars": rows,
        "summary": {"cars": len(rows), "liveNow": sum(r["live"] for r in rows), "km30": round(sum(r["km30"] for r in rows), 1),
                    "trips30": sum(r["trips30"] for r in rows), "lastDriven": last["id"] if last else None},
        "at": now,
    }
