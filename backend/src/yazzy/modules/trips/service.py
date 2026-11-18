import time
import uuid

from sqlalchemy import delete, func, or_, select

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


# How far either side of new readings to look for the silences that bound their journey.
LOOKBACK_SECONDS = 2 * 86400
# Readings one job may load. Ranges beyond it go to a follow-up job, so each job finishes well
# inside its lease on a 0.1-CPU host however much history the vehicle has.
ROW_BUDGET = 60000


def recent_ranges(db, tenant_id, vehicle_id, run_id, since):
    """Every recording session with readings after `since`, as reconciliation ranges."""
    rows = db.execute(
        select(
            Sample.device_id,
            Sample.session_id,
            func.min(Sample.observed_at),
            func.max(Sample.observed_at),
        )
        .where(
            Sample.tenant_id == tenant_id,
            Sample.vehicle_id == vehicle_id,
            Sample.run_id == run_id,
            Sample.observed_at >= since,
        )
        .group_by(Sample.device_id, Sample.session_id)
    ).all()
    return [{"deviceId": d, "sessionId": s, "from": lo, "to": hi} for d, s, lo, hi in rows]


def merge_ranges(ranges):
    """One range per recording session, oldest first."""
    merged = {}
    for r in ranges:
        key = (r["deviceId"], r["sessionId"])
        lo, hi = merged.get(key, (r["from"], r["to"]))
        merged[key] = (min(lo, r["from"]), max(hi, r["to"]))
    ordered = sorted(merged.items(), key=lambda item: item[1][0])
    return [{"deviceId": d, "sessionId": s, "from": lo, "to": hi} for (d, s), (lo, hi) in ordered]


def journey_bounds(db, scope, start, end):
    """Widens [start, end] to the silences longer than JOURNEY_GAP_SECONDS around it."""
    previous = func.lag(Sample.observed_at).over(order_by=Sample.observed_at)
    before = (
        select(Sample.observed_at.label("t"), previous.label("p"))
        .where(*scope, Sample.observed_at <= start, Sample.observed_at >= start - LOOKBACK_SECONDS)
        .subquery()
    )
    first = db.scalar(
        select(func.max(before.c.t)).where(
            or_(before.c.p.is_(None), before.c.t - before.c.p > JOURNEY_GAP_SECONDS)
        )
    )
    following = func.lead(Sample.observed_at).over(order_by=Sample.observed_at)
    after = (
        select(Sample.observed_at.label("t"), following.label("n"))
        .where(*scope, Sample.observed_at >= end, Sample.observed_at <= end + LOOKBACK_SECONDS)
        .subquery()
    )
    last = db.scalar(
        select(func.min(after.c.t)).where(
            or_(after.c.n.is_(None), after.c.n - after.c.t > JOURNEY_GAP_SECONDS)
        )
    )
    return (start if first is None else min(first, start)), (
        end if last is None else max(last, end)
    )


def reconcile(db, tenant_id, vehicle_id, run_id=None, ranges=None):
    """Rebuilds the trips of the journeys that `ranges` touch (every session of the last three
    days when None). Only those journeys are loaded, never the vehicle's whole history: loading
    all of it failed past 100 000 readings, so no trip was saved any more."""
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
    if ranges is None:
        ranges = recent_ranges(db, tenant_id, vehicle_id, run_id, now - 3 * 86400)
    pending = merge_ranges(ranges)
    journeys, cleared, loaded, remaining = [], [], 0, []
    for index, r in enumerate(pending):
        if loaded >= ROW_BUDGET:
            remaining = pending[index:]
            break
        scope = (
            Sample.tenant_id == tenant_id,
            Sample.vehicle_id == vehicle_id,
            Sample.run_id == run_id,
            Sample.device_id == r["deviceId"],
            Sample.session_id == r["sessionId"],
        )
        first, last = journey_bounds(db, scope, r["from"], r["to"])
        # Plain column tuples, not ORM objects: building tracked objects starved the API of CPU.
        rows = db.execute(
            select(Sample.observed_at, Sample.signal, Sample.value, Sample.quality)
            .where(*scope, Sample.observed_at >= first, Sample.observed_at <= last)
            .order_by(Sample.observed_at, Sample.sequence)
        ).all()
        if not rows:
            continue
        loaded += len(rows)
        resumed = (
            db.scalar(select(Sample.id).where(*scope, Sample.observed_at > last).limit(1))
            is not None
        )
        chunks = split_on_gaps([Observation(*row) for row in rows])
        journeys += [
            (r["deviceId"], r["sessionId"], chunk, i == len(chunks) - 1 and not resumed)
            for i, chunk in enumerate(chunks)
        ]
        cleared.append((r["sessionId"], first, last))
    revisions = list(
        db.scalars(
            select(Revision)
            .where(Revision.tenant_id == tenant_id, Revision.vehicle_id == vehicle_id)
            .order_by(Revision.created_at)
        )
    )
    # Retained session boundaries make replay idempotent; session handover uncertainty is explicit.
    results, windows = [], []
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
    for session_id, first, last in cleared:
        db.execute(
            delete(Trip).where(
                Trip.tenant_id == tenant_id,
                Trip.vehicle_id == vehicle_id,
                Trip.run_id == run_id,
                Trip.session_id == session_id,
                Trip.start_at >= first,
                Trip.start_at <= last,
            )
        )
    db.add_all(results)
    # Readings arrived after these sessions' earlier journeys, so those journeys did end.
    for session_id, first, _ in cleared:
        for earlier in db.scalars(
            select(Trip).where(
                Trip.tenant_id == tenant_id,
                Trip.vehicle_id == vehicle_id,
                Trip.run_id == run_id,
                Trip.session_id == session_id,
                Trip.start_at < first,
                Trip.status.in_(["ACTIVE", "PAUSED", "UNCERTAIN"]),
            )
        ):
            earlier.status = "CLOSED"
            earlier.metrics = {
                **earlier.metrics,
                "endReason": earlier.metrics.get("endReason") or "RECORDING_GAP",
            }
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
    # Journeys outside this run keep the warm-idle trim windows earlier runs saved.
    kept = {
        key: w
        for key, w in (baseline.data.get("windows") or {}).items()
        if not any(w["sessionId"] == s and a <= w["startAt"] <= b for s, a, b in cleared)
    }
    kept.update({f"{w['sessionId']}:{w['startAt']}": w for w in windows})
    kept = dict(sorted(kept.items(), key=lambda item: item[1]["startAt"])[-400:])
    eligible = sorted(
        [w for w in kept.values() if w["startAt"] >= baseline.reset_at], key=lambda w: w["startAt"]
    )
    data, evidence = trim_finding(eligible, baseline.data.get("reference"))
    baseline.status, baseline.data = data["status"], {**data, "windows": kept}
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
    return {
        "tripCount": len(results),
        "sampleCount": loaded,
        "baselineStatus": baseline.status,
        "remaining": remaining,
    }
