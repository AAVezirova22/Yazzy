import time
import uuid
from collections import defaultdict

from sqlalchemy import delete, select

from yazzy.infrastructure.models import (
    Baseline,
    Finding,
    Revision,
    Sample,
    SimulationRun,
    Trip,
    Vehicle,
)
from yazzy.modules.intelligence.domain import trim_finding, warm_idle_trim
from yazzy.modules.trips.domain import Observation, metrics, segment


def stable_id(*parts):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, ":".join(map(str, parts))))


# A recording that goes silent this long (adapter unpowered after the engine is switched
# off) ends one journey; the next readings begin a new one. Polling normally produces
# several readings per second, so shorter silences are ordinary Bluetooth hiccups.
JOURNEY_GAP_SECONDS = 120.0


def split_on_gaps(observations, gap=JOURNEY_GAP_SECONDS):
    chunks, current, previous = [], [], None
    for o in sorted(observations, key=lambda o: o.time):
        if previous is not None and o.time - previous > gap:
            chunks.append(current)
            current = []
        current.append(o)
        previous = o.time
    if current:
        chunks.append(current)
    return chunks


def reconcile(db, tenant_id, vehicle_id, run_id=None):
    # Vehicle row lock prevents two jobs publishing summaries from different snapshots.
    vehicle = db.scalar(
        select(Vehicle)
        .where(Vehicle.id == vehicle_id, Vehicle.tenant_id == tenant_id)
        .with_for_update()
    )
    if not vehicle or vehicle.archived:
        return {"skipped": "VEHICLE_ARCHIVED"}
    run = db.get(SimulationRun, run_id) if run_id else None
    if run_id and (run is None or run.status == "RESET"):
        return {"skipped": "OLD_RUN"}
    now = run.virtual_now if run else time.time()
    rows = list(
        db.scalars(
            select(Sample)
            .where(
                Sample.tenant_id == tenant_id,
                Sample.vehicle_id == vehicle_id,
                Sample.run_id == run_id,
            )
            .order_by(Sample.observed_at, Sample.sequence)
            .limit(100001)
        )
    )
    if len(rows) > 100000:
        raise ValueError(
            "RECONCILIATION_WINDOW_TOO_LARGE: partition sessions before expanding retention"
        )
    sessions = defaultdict(list)
    for row in rows:
        sessions[(row.device_id, row.session_id)].append(
            Observation(row.observed_at, row.signal, row.value, row.quality)
        )
    revisions = list(
        db.scalars(
            select(Revision)
            .where(Revision.tenant_id == tenant_id, Revision.vehicle_id == vehicle_id)
            .order_by(Revision.created_at)
        )
    )
    # Retained session boundaries make replay idempotent; session handover uncertainty is explicit.
    results, windows = [], []
    journeys = [
        (device_id, session_id, chunk, index == len(chunks) - 1)
        for (device_id, session_id), all_observations in sessions.items()
        for chunks in [split_on_gaps(all_observations)]
        for index, chunk in enumerate(chunks)
    ]
    for device_id, session_id, observations, is_last in journeys:
        spans = segment(observations, now)
        if not is_last:
            # Readings resumed later, so this journey is known to have ended in the silence.
            spans = [
                {**span, "status": "CLOSED", "endReason": span["endReason"] or "RECORDING_GAP"}
                if span["status"] in {"ACTIVE", "PAUSED", "UNCERTAIN"}
                else span
                for span in spans
            ]
        for revision in revisions:
            p = revision.payload
            if p.get("sessionId") != session_id:
                continue
            if revision.kind == "SPLIT":
                split_at = p["at"]
                new = []
                for span in spans:
                    if span["start"] < split_at < span["end"]:
                        new.extend(
                            [
                                {
                                    **span,
                                    "end": split_at,
                                    "status": "CLOSED",
                                    "endReason": "USER_CORRECTION",
                                },
                                {**span, "start": split_at},
                            ]
                        )
                    else:
                        new.append(span)
                spans = new
            elif revision.kind == "MERGE":
                selected = [s for s in spans if p["start"] <= s["start"] and s["end"] <= p["end"]]
                spans = [s for s in spans if s not in selected]
                if selected:
                    spans.append(
                        {
                            "start": p["start"],
                            "end": p["end"],
                            "status": "CLOSED",
                            "detected": now,
                            "endReason": "USER_CORRECTION",
                        }
                    )
        spans.sort(key=lambda s: s["start"])
        # Track stationary fuel outside journeys instead of silently discarding it.
        cursor = observations[0].time
        full = []
        for span in spans:
            if span["start"] > cursor:
                full.append(
                    {
                        "start": cursor,
                        "end": span["start"],
                        "status": "STATIONARY",
                        "detected": now,
                        "endReason": None,
                    }
                )
            full.append(span)
            cursor = span["end"]
        if observations[-1].time > cursor:
            full.append(
                {
                    "start": cursor,
                    "end": observations[-1].time,
                    "status": "STATIONARY",
                    "detected": now,
                    "endReason": None,
                }
            )
        # One recording = one journey: idle time before the car first moves and after it last
        # stops belongs to that journey. Parking confirmed by ignition-off stays separate.
        if len(full) >= 2 and full[0]["status"] == "STATIONARY" != full[1]["status"]:
            full = [{**full[1], "start": full[0]["start"]}, *full[2:]]
        if (
            len(full) >= 2
            and full[-1]["status"] == "STATIONARY" != full[-2]["status"]
            and full[-2]["endReason"] != "CONFIRMED_PARKING"
        ):
            full = [*full[:-2], {**full[-2], "end": full[-1]["end"]}]
        for span in full:
            calc = metrics(observations, span["start"], span["end"], vehicle.capabilities)
            calc["endReason"] = span["endReason"]
            results.append(
                Trip(
                    id=stable_id(
                        vehicle_id,
                        device_id,
                        session_id,
                        span["start"],
                        span["status"] == "STATIONARY",
                    ),
                    tenant_id=tenant_id,
                    vehicle_id=vehicle_id,
                    device_id=device_id,
                    session_id=session_id,
                    run_id=run_id,
                    origin=vehicle.origin,
                    start_at=span["start"],
                    end_at=span["end"],
                    detected_at=span["detected"],
                    status=span["status"],
                    metrics=calc,
                )
            )
        windows.append(
            {
                "sessionId": session_id,
                "startAt": observations[0].time,
                "endAt": observations[-1].time,
                "trim": warm_idle_trim(observations),
            }
        )
    db.execute(
        delete(Trip).where(
            Trip.tenant_id == tenant_id,
            Trip.vehicle_id == vehicle_id,
            Trip.run_id == run_id,
            Trip.session_id.in_([sid for _, sid in sessions]),
        )
    )
    db.add_all(results)
    baseline = db.scalar(
        select(Baseline).where(
            Baseline.tenant_id == tenant_id,
            Baseline.vehicle_id == vehicle_id,
            Baseline.run_id == run_id,
        )
    )
    if baseline is None:
        baseline = Baseline(
            tenant_id=tenant_id,
            vehicle_id=vehicle_id,
            run_id=run_id,
            origin=vehicle.origin,
            status="LEARNING",
            data={},
            reset_at=0,
        )
        db.add(baseline)
    windows = sorted(
        [w for w in windows if w["startAt"] >= baseline.reset_at], key=lambda w: w["startAt"]
    )
    data, evidence = trim_finding(windows, baseline.data.get("reference"))
    baseline.status, baseline.data = data["status"], data
    finding_id = stable_id(vehicle_id, run_id, "FUEL_TRIM_DRIFT", baseline.version or 1)
    prior = db.get(Finding, finding_id)
    if evidence:
        if prior is None:
            db.add(
                Finding(
                    id=finding_id,
                    tenant_id=tenant_id,
                    vehicle_id=vehicle_id,
                    run_id=run_id,
                    origin=vehicle.origin,
                    type="FUEL_TRIM_DRIFT",
                    status="INSPECTION_RECOMMENDED",
                    severity="ADVISORY",
                    summary="Fuel compensation increased in comparable warm-idle windows.",
                    evidence={
                        **evidence,
                        "baselineVersion": baseline.version or 1,
                        "isSimulated": vehicle.origin == "SIMULATED",
                    },
                )
            )
        # Evidence remains immutable for the finding episode.
    elif prior and baseline.status == "MONITORING":
        prior.status, prior.resolved_at = "RESOLVED", now
    db.flush()
    return {"tripCount": len(results), "sampleCount": len(rows), "baselineStatus": baseline.status}
