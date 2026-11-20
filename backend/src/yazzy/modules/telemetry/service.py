import hashlib
import json
import time

from sqlalchemy import select

from yazzy.config import settings
from yazzy.infrastructure.models import (
    Assignment,
    Batch,
    Device,
    Job,
    Sample,
    SimulationRun,
    Vehicle,
    uid,
)
from yazzy.modules.identity.policy import fail
from yazzy.modules.telemetry.contracts import Position, TelemetryBatch

# Seconds a device clock may run ahead of the server, or behind it at the start of a pairing.
CLOCK_TOLERANCE = 120
# samples.monotonic_ms is a 32-bit column. A phone's uptime passes this after ~24.9 days without a
# restart, and PostgreSQL then refused every reading with "integer out of range" (HTTP 500).
# Nothing reads the value, so larger ones are stored as unknown rather than failing the upload.
INT32_MAX = 2_147_483_647


def hash_payload(payload):
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def ingest(db, device: Device, batch: TelemetryBatch):
    run = (
        db.scalar(select(SimulationRun).where(SimulationRun.id == device.run_id).with_for_update())
        if device.run_id
        else None
    )
    # Per-device lock serialises batch/sequence conflict checks in PostgreSQL.
    device = db.scalar(select(Device).where(Device.id == device.id).with_for_update())
    if device.revoked or batch.device_id != device.id or batch.source != device.source:
        fail("DEVICE_ASSIGNMENT_MISMATCH", 403)
    if (device.origin == "SIMULATED") != (batch.platform == "SIMULATOR"):
        fail("ORIGIN_MISMATCH", 403)
    assignment = db.scalar(
        select(Assignment).where(
            Assignment.id == batch.assignment_id,
            Assignment.tenant_id == device.tenant_id,
            Assignment.device_id == device.id,
        )
    )
    if assignment is None:
        fail("DEVICE_ASSIGNMENT_MISMATCH", 403)
    owner = db.scalar(
        select(Vehicle)
        .where(Vehicle.id == assignment.vehicle_id, Vehicle.tenant_id == device.tenant_id)
        .with_for_update()
    )
    if not owner or owner.archived or owner.origin != device.origin:
        fail("VEHICLE_NOT_RECORDABLE", 409)
    now = time.time()
    if device.origin == "SIMULATED":
        if (
            not run
            or run.status == "RESET"
            or batch.simulation_run_id != run.id
            or batch.scenario_seed != run.seed
            or batch.scenario_version != run.scenario_version
        ):
            fail("SIMULATION_RUN_MISMATCH", 409)
        clock, oldest = run.virtual_now, run.start_at
    else:
        if (
            batch.simulation_run_id is not None
            or batch.scenario_version is not None
            or batch.scenario_seed is not None
        ):
            fail("SIMULATION_REAL_TENANT_DENIED", 403)
        clock, oldest = now, now - 30 * 86400
    payload_hash = hash_payload(batch.model_dump(mode="json", by_alias=True))
    prior = db.scalar(
        select(Batch).where(Batch.device_id == device.id, Batch.batch_key == batch.batch_id)
    )
    if prior:
        if prior.payload_hash != payload_hash:
            fail("IDEMPOTENCY_CONFLICT", 409)
        return {
            "accepted": True,
            "duplicate": True,
            "jobId": prior.job_id,
            "receivedAt": prior.received_at,
        }
    # A phone clock a little behind the server's must not strand the first readings of a new
    # pairing. Before its first assignment nothing else can own this device's readings.
    earliest = assignment.valid_from
    if device.origin != "SIMULATED" and not db.scalar(
        select(Assignment.id)
        .where(
            Assignment.device_id == device.id,
            Assignment.valid_from < assignment.valid_from,
        )
        .limit(1)
    ):
        earliest -= CLOCK_TOLERANCE
    # Readings outside the assignment or clock window are dropped one by one. Refusing the
    # whole batch would block every later reading queued behind it on the phone.
    hashes, rejected = {}, {}
    for sample in batch.samples:
        timestamp = sample.observed_at.timestamp()
        if timestamp < earliest or (
            assignment.valid_until is not None and timestamp >= assignment.valid_until
        ):
            reason = "OUTSIDE_ASSIGNMENT"
        elif timestamp > clock + CLOCK_TOLERANCE or timestamp < oldest:
            reason = "CLOCK_SKEW_OR_RETENTION_WINDOW"
        else:
            hashes[sample.sequence] = hash_payload(sample.model_dump(mode="json", by_alias=True))
            continue
        rejected[reason] = rejected.get(reason, 0) + 1
    existing = {
        s.sequence: s
        for s in db.scalars(
            select(Sample).where(
                Sample.device_id == device.id,
                Sample.session_id == batch.session_id,
                Sample.sequence.in_(hashes),
            )
        )
    }
    for seq, stored in existing.items():
        if stored.payload_hash != hashes[seq] or stored.assignment_id != assignment.id:
            fail("SEQUENCE_CONFLICT", 409)
    job_id = uid()
    # A phone uploads every minute or so while the car drives, and each rebuild rereads the
    # whole drive so far from the database, whose outgoing data is metered. So while driving,
    # the rebuild waits (a pending job's lease_until is the earliest it may run) and one pass
    # covers every upload queued by then. When the drive ends it runs at once.
    ended = any(
        (s.signal == "IGNITION" and s.value in (0, False)) or s.signal == "USER_STOP"
        for s in batch.samples
    )
    delay = 0 if ended or device.run_id else settings.rebuild_delay_seconds
    accepted = [
        s.observed_at.timestamp()
        for s in batch.samples
        if s.sequence in hashes and s.sequence not in existing
    ]
    db.add(
        Job(
            id=job_id,
            tenant_id=device.tenant_id,
            kind="RECONCILE",
            key=f"batch:{device.id}:{batch.batch_id}",
            lease_until=now + delay if delay else 0,
            payload={
                "vehicleId": owner.id,
                "runId": device.run_id,
                "runGeneration": run.generation if run else None,
                "ranges": [
                    {
                        "deviceId": device.id,
                        "sessionId": batch.session_id,
                        "from": min(accepted),
                        "to": max(accepted),
                    }
                ]
                if accepted
                else [],
            },
        )
    )
    db.add(
        Batch(
            tenant_id=device.tenant_id,
            device_id=device.id,
            batch_key=batch.batch_id,
            payload_hash=payload_hash,
            job_id=job_id,
            received_at=now,
        )
    )
    for sample in batch.samples:
        if sample.sequence not in hashes or sample.sequence in existing:
            continue
        value = (
            sample.value.model_dump(by_alias=True)
            if isinstance(sample.value, Position)
            else sample.value
        )
        db.add(
            Sample(
                tenant_id=device.tenant_id,
                device_id=device.id,
                assignment_id=assignment.id,
                vehicle_id=owner.id,
                session_id=batch.session_id,
                sequence=sample.sequence,
                observed_at=sample.observed_at.timestamp(),
                monotonic_ms=sample.monotonic_ms
                if sample.monotonic_ms is not None and sample.monotonic_ms <= INT32_MAX
                else None,
                signal=sample.signal,
                value=value,
                quality=sample.quality,
                unit=sample.unit,
                origin=device.origin,
                run_id=device.run_id,
                decoder_version=batch.decoder_version,
                received_at=now,
                payload_hash=hashes[sample.sequence],
            )
        )
    device.last_received_at = now
    db.flush()
    return {
        "accepted": True,
        "duplicate": False,
        "acceptedSamples": len(hashes) - len(existing),
        "rejectedSamples": sum(rejected.values()),
        "rejected": rejected,
        "jobId": job_id,
        "receivedAt": now,
        "dataOrigin": device.origin,
    }
