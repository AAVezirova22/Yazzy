"""Explicit tenant-scoped retention and vehicle erasure. No blanket database resets."""

import argparse
import time

from sqlalchemy import delete, select

from yazzy.infrastructure.db import transaction
from yazzy.infrastructure.models import (
    Assignment,
    Baseline,
    Batch,
    Device,
    Finding,
    FuelEntry,
    Job,
    Maintenance,
    PendingAction,
    Preference,
    Quote,
    Revision,
    Sample,
    Trip,
    WorkOrder,
)
from yazzy.modules.identity.policy import audit, vehicle


def erase_vehicle(db, ctx, vehicle_id):
    v = vehicle(db, ctx, vehicle_id, write=True)
    if not v.archived:
        raise ValueError("Archive the vehicle before erasure")
    device_ids = list(
        db.scalars(
            select(Assignment.device_id).where(
                Assignment.tenant_id == ctx.tenant_id, Assignment.vehicle_id == v.id
            )
        )
    )
    # Shared/reassigned collectors remain revoked until deliberately reenrolled.
    for d in db.scalars(
        select(Device).where(Device.tenant_id == ctx.tenant_id, Device.id.in_(device_ids))
    ):
        d.revoked = True
    for cls in [
        Sample,
        Trip,
        Revision,
        FuelEntry,
        Finding,
        Baseline,
        Maintenance,
        WorkOrder,
        Quote,
    ]:
        db.execute(
            delete(cls).where(
                cls.__table__.c.tenant_id == ctx.tenant_id, cls.__table__.c.vehicle_id == v.id
            )
        )
    for j in db.scalars(select(Job).where(Job.tenant_id == ctx.tenant_id)):
        if j.payload.get("vehicleId") == v.id or v.id in j.payload.get("vehicleIds", []):
            j.status, j.result, j.payload = "CANCELLED", None, {"erased": True}
    for a in db.scalars(select(PendingAction).where(PendingAction.tenant_id == ctx.tenant_id)):
        if a.payload.get("vehicleId") == v.id:
            a.status, a.payload = "CANCELLED", {"erased": True}
    db.execute(
        delete(Assignment).where(
            Assignment.tenant_id == ctx.tenant_id, Assignment.vehicle_id == v.id
        )
    )
    db.execute(
        delete(Batch).where(Batch.tenant_id == ctx.tenant_id, Batch.device_id.in_(device_ids))
    )
    v.name, v.make, v.model, v.capabilities, v.odometer_km = "Erased vehicle", "", "", {}, None
    v.year, v.service_due_at, v.service_due_km = None, None, None
    audit(db, ctx, "VEHICLE_DATA_ERASED", v.id)


def purge(db, tenant_id, now=None):
    now = now or time.time()
    prefs = list(db.scalars(select(Preference).where(Preference.tenant_id == tenant_id)))
    days = min((p.raw_days for p in prefs), default=30)
    route_days = min((p.route_days for p in prefs), default=90)
    # Never purge while required calculations are outstanding.
    pending = db.scalar(
        select(Job)
        .where(Job.tenant_id == tenant_id, Job.status.in_(["PENDING", "RUNNING"]))
        .limit(1)
    )
    if pending:
        return {"skipped": "JOBS_PENDING"}
    result = db.execute(
        delete(Sample).where(Sample.tenant_id == tenant_id, Sample.observed_at < now - days * 86400)
    )
    for trip in db.scalars(
        select(Trip).where(Trip.tenant_id == tenant_id, Trip.start_at < now - route_days * 86400)
    ):
        trip.metrics = {**trip.metrics, "route": [], "routeRetention": "EXPIRED"}
    return {"deletedSamples": result.rowcount}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--tenant", required=True)
    args = p.parse_args()
    with transaction(args.tenant) as db:
        print(purge(db, args.tenant))


if __name__ == "__main__":
    main()
