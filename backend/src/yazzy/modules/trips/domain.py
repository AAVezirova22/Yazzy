"""Deterministic, restart/replay-safe trip and measurement rules. No infrastructure imports."""

import math
from dataclasses import dataclass
from typing import Any

CALCULATION_VERSION = "trip-fuel-v1"
MAX_GAP = 15.0
END_CONFIRMATION = 180.0
HARD_ACCELERATION = 2.5  # m/s^2, averaged over at least one second
HARD_BRAKING = -3.0  # m/s^2
EVENT_WINDOW = (1.0, 3.0)  # seconds between the two speed readings an acceleration is measured over
EVENT_POSITION_TOLERANCE = 15.0  # seconds to the nearest GPS fix before a position is withheld


@dataclass(frozen=True)
class Observation:
    time: float
    signal: str
    value: Any
    quality: str = "VALID"


def series(observations, signal):
    # Deterministic handling of same-time observations, established source priority upstream.
    return sorted(
        {
            o.time: o.value
            for o in observations
            if o.signal == signal and o.quality == "VALID" and o.value is not None
        }.items()
    )


def integrate(points, start, end, divisor=3600, max_gap=MAX_GAP):
    total, covered = 0.0, 0.0
    for (ta, a), (tb, b) in zip(points, points[1:], strict=False):
        dt = tb - ta
        lo, hi = max(start, ta), min(end, tb)
        if 0 < dt <= max_gap and hi > lo:
            va = a + (b - a) * (lo - ta) / dt
            vb = a + (b - a) * (hi - ta) / dt
            total += (va + vb) / 2 * (hi - lo) / divisor
            covered += hi - lo
    return (total if covered else None), covered


def haversine(a, b):
    la, lb = math.radians(a["latitude"]), math.radians(b["latitude"])
    dlat, dlon = lb - la, math.radians(b["longitude"] - a["longitude"])
    h = math.sin(dlat / 2) ** 2 + math.cos(la) * math.cos(lb) * math.sin(dlon / 2) ** 2
    return 6371 * 2 * math.asin(min(1, math.sqrt(h)))


def good_fix(value):
    return (
        value.get("validFix", value.get("valid_fix", False))
        and value["accuracy"] <= 30
        and value.get("fixAge", value.get("fix_age", 0)) <= 10
    )


def driving_events(speeds, route):
    """Hard acceleration and braking from OBD speed. Positions are the nearest GPS fix in time."""
    low, high = EVENT_WINDOW
    rates = []
    for i, (t, v) in enumerate(speeds):
        j = next((k for k in range(i + 1, len(speeds)) if speeds[k][0] - t >= low), None)
        if j is None or speeds[j][0] - t > high:
            continue
        rates.append((i, j, (speeds[j][1] - v) / 3.6 / (speeds[j][0] - t)))
    events: list[dict[str, Any]] = []
    run: list[tuple[int, int, float]] = []

    def close():
        if not run:
            return
        kind = "HARD_ACCELERATION" if run[0][2] > 0 else "HARD_BRAKING"
        i, _, peak = max(run, key=lambda r: abs(r[2]))
        first, last = run[0][0], run[-1][1]
        fix = min(route, key=lambda p: abs(p["time"] - speeds[i][0]), default=None)
        position = None
        if fix is not None and abs(fix["time"] - speeds[i][0]) <= EVENT_POSITION_TOLERANCE:
            position = fix
        events.append(
            {
                "type": kind,
                "time": speeds[i][0],
                "peakMetresPerSecond2": round(peak, 2),
                "fromKmh": speeds[first][1],
                "toKmh": speeds[last][1],
                "durationSeconds": speeds[last][0] - speeds[first][0],
                "latitude": position["latitude"] if position else None,
                "longitude": position["longitude"] if position else None,
            }
        )
        run.clear()

    for entry in rates:
        sign = (entry[2] >= HARD_ACCELERATION) - (entry[2] <= HARD_BRAKING)
        previous = (run[-1][2] > 0) - (run[-1][2] < 0) if run else 0
        if sign == 0 or (run and (sign != previous or entry[0] != run[-1][0] + 1)):
            close()
        if sign:
            run.append(entry)
    close()
    return events


def metrics(observations, start, end, capabilities=None):
    capabilities = capabilities or {}
    duration = max(0, end - start)
    speeds, rates = series(observations, "VEHICLE_SPEED"), series(observations, "FUEL_RATE")
    distance, dist_time = integrate(speeds, start, end)
    method = "OBD_SPEED" if distance is not None else "UNAVAILABLE"
    odometer = [(t, v) for t, v in series(observations, "ODOMETER") if start <= t <= end]
    if capabilities.get("validatedOdometer") and len(odometer) >= 2:
        delta = odometer[-1][1] - odometer[0][1]
        elapsed = odometer[-1][0] - odometer[0][0]
        if 0 <= delta <= elapsed * 350 / 3600:
            distance, dist_time, method = delta, elapsed, "VALIDATED_ODOMETER"
    gps = [(t, v) for t, v in series(observations, "GPS") if start <= t <= end and good_fix(v)]
    gps_distance, gps_time = 0.0, 0.0
    route = []
    for i, (t, position) in enumerate(gps):
        route.append({"time": t, **position})
        if i:
            prev_t, prev = gps[i - 1]
            dt, d = t - prev_t, haversine(prev, position)
            if 0 < dt <= MAX_GAP and d * 3600 / dt <= 200:
                gps_time += dt
                if d * 1000 > max(3, min(position["accuracy"], prev["accuracy"])):
                    gps_distance += d
    if distance is None and gps_time:
        distance, dist_time, method = gps_distance, gps_time, "FILTERED_GPS"
    events = driving_events([(t, v) for t, v in speeds if start <= t <= end], route)
    fuel, fuel_time = integrate(rates, start, end)
    fuel_method = "ECU_RATE" if fuel is not None else "UNAVAILABLE"
    counters = [(t, v) for t, v in series(observations, "FUEL_COUNTER") if start <= t <= end]
    if capabilities.get("validatedFuelCounter") and len(counters) >= 2:
        deltas = [
            (b - a, tb - ta) for (ta, a), (tb, b) in zip(counters, counters[1:], strict=False)
        ]
        accepted = [(d, t) for d, t in deltas if 0 < t <= MAX_GAP and 0 <= d <= t * 200 / 3600]
        if accepted:
            fuel, fuel_time, fuel_method = (
                sum(d for d, _ in accepted),
                sum(t for _, t in accepted),
                "VALIDATED_COUNTER",
            )
    if fuel is None and capabilities.get("qualifiedPetrolMaf"):
        maf = [(t, 3600 * v / (14.7 * 745)) for t, v in series(observations, "MAF")]
        fuel, fuel_time = integrate(maf, start, end)
        if fuel is not None:
            fuel_method = "MAF_ESTIMATE_PETROL"
    rpms = dict(series(observations, "ENGINE_RPM"))
    moving = idle = engine_off = 0.0
    idle_fuel = 0.0
    idle_fuel_covered = 0.0
    for (t, speed), (nt, nspeed) in zip(speeds, speeds[1:], strict=False):
        lo, hi = max(start, t), min(end, nt)
        if not 0 < nt - t <= MAX_GAP or hi <= lo:
            continue
        seconds = hi - lo
        if speed > 1 or nspeed > 1:
            moving += seconds
        else:
            rpm_points = [(rt, rv) for rt, rv in rpms.items() if 0 <= t - rt <= MAX_GAP]
            rpm = max(rpm_points, default=(0, None))[1]
            if rpm is not None and rpm > 0:
                idle += seconds
                amount, covered = integrate(rates, lo, hi)
                idle_fuel += amount or 0
                idle_fuel_covered += covered
            elif rpm == 0:
                engine_off += seconds
    ratio = (
        100 * fuel / distance
        if fuel is not None
        and distance is not None
        and distance >= 0.1
        and duration > 0
        and min(fuel_time, dist_time) / duration >= 0.99
        else None
    )
    return {
        "distanceKm": distance,
        "distanceMethod": method,
        "distanceCoverage": min(1, dist_time / duration) if duration else 0,
        "fuelLitres": fuel,
        "fuelMethod": fuel_method,
        "fuelCoverage": min(1, fuel_time / duration) if duration else 0,
        "durationSeconds": duration,
        "coveredFuelSeconds": fuel_time,
        "coveredDistanceSeconds": dist_time,
        "movingSeconds": moving,
        "idleEngineSeconds": idle,
        "engineOffStopSeconds": engine_off,
        "idleFuelLitres": idle_fuel if idle_fuel_covered else None,
        "litresPer100Km": ratio,
        "locationCoverage": min(1, gps_time / duration) if duration else 0,
        "route": route[:: max(1, math.ceil(len(route) / 500))],
        "drivingEvents": events,
        "gaps": sum(
            1 for (a, _), (b, _) in zip(speeds, speeds[1:], strict=False) if b - a > MAX_GAP
        ),
    }


def segment(observations, now):
    """RPM is never a trip-end signal. Parking needs explicit ignition/user-stop evidence.

    Sessions with movement but missing end evidence remain UNCERTAIN. A deliberate
    recording stop closes with an explicit reason, never implies the car was parked.
    """
    speeds = series(observations, "VEHICLE_SPEED")
    if not speeds:
        # GPS fallback supports movement without an OBD speed PID.
        gps = [(t, v) for t, v in series(observations, "GPS") if good_fix(v)]
        speeds = [
            (b, haversine(pa, pb) * 3600 / (b - a))
            for (a, pa), (b, pb) in zip(gps, gps[1:], strict=False)
            if 0 < b - a <= MAX_GAP and haversine(pa, pb) * 3600 / (b - a) <= 200
        ]
    ignition = series(observations, "IGNITION")
    stops = series(observations, "USER_STOP")
    results, active, candidate, parked_since = [], None, None, None
    for t, speed in speeds:
        state = next((v for it, v in reversed(ignition) if it <= t and t - it <= MAX_GAP), None)
        if speed > 5:
            if active is None:
                if candidate is None or t - candidate > 30:
                    candidate = t
                elif t - candidate >= 3:
                    active = candidate
            parked_since = None
        elif active is not None and speed <= 1 and state == 0:
            parked_since = t if parked_since is None else parked_since
            if t - parked_since >= END_CONFIRMATION:
                results.append(
                    {
                        "start": active,
                        "end": parked_since,
                        "status": "CLOSED",
                        "detected": t,
                        "endReason": "CONFIRMED_PARKING",
                    }
                )
                active, candidate, parked_since = None, None, None
        elif speed > 1 or state != 0:
            parked_since = None
        if active is None and speed <= 5:
            candidate = None
    if active is not None:
        last = speeds[-1][0]
        stop = next((t for t, v in stops if t >= active and v == 1), None)
        # The phone marks ignition off once the car stops answering while standing still (switched
        # off), so the marker comes after the last speed reading and no speed follows to confirm
        # parking over time: it ends the trip. An ignition-off reading alongside the last speed
        # reading, then silence, stays uncertain.
        off = next((t for t, v in ignition if t > last and v == 0), None)
        if stop is None and off is not None and speeds[-1][1] <= 1:
            results.append(
                {
                    "start": active,
                    "end": last,
                    "status": "CLOSED",
                    "detected": off,
                    "endReason": "IGNITION_OFF",
                }
            )
        elif stop is not None:
            results.append(
                {
                    "start": active,
                    "end": stop,
                    "status": "CLOSED",
                    "detected": stop,
                    "endReason": "USER_STOP",
                }
            )
        else:
            status = (
                "UNCERTAIN" if now - last > 30 else ("PAUSED" if speeds[-1][1] <= 1 else "ACTIVE")
            )
            results.append(
                {
                    "start": active,
                    "end": last,
                    "status": status,
                    "detected": now,
                    "endReason": "EVIDENCE_LOST" if status == "UNCERTAIN" else None,
                }
            )
    return results


def aggregate(trips):
    metrics_list = [t.metrics if hasattr(t, "metrics") else t for t in trips]
    distances = [m["distanceKm"] for m in metrics_list if m["distanceKm"] is not None]
    fuels = [m["fuelLitres"] for m in metrics_list if m["fuelLitres"] is not None]
    paired = [
        m
        for m in metrics_list
        if m["distanceKm"] is not None
        and m["fuelLitres"] is not None
        and m["durationSeconds"] > 0
        and min(m["coveredFuelSeconds"], m["coveredDistanceSeconds"]) / m["durationSeconds"] >= 0.99
    ]
    distance, fuel = sum(distances) if distances else None, sum(fuels) if fuels else None
    paired_distance = sum(m["distanceKm"] for m in paired)
    duration = sum(m["durationSeconds"] for m in metrics_list)
    return {
        "distanceKm": distance,
        "fuelLitres": fuel,
        "litresPer100Km": 100 * sum(m["fuelLitres"] for m in paired) / paired_distance
        if paired_distance >= 0.1
        else None,
        "fuelCoverage": sum(m["coveredFuelSeconds"] for m in metrics_list) / duration
        if duration
        else 0,
        "distanceCoverage": sum(m["coveredDistanceSeconds"] for m in metrics_list) / duration
        if duration
        else 0,
        "idleEngineSeconds": sum(m["idleEngineSeconds"] for m in metrics_list),
        "idleFuelLitres": sum(m["idleFuelLitres"] or 0 for m in metrics_list)
        if any(m["idleFuelLitres"] is not None for m in metrics_list)
        else None,
        "tripCount": len(metrics_list),
        "calculationVersion": CALCULATION_VERSION,
        "efficiencyMethod": "RATIO_OF_SUMS_FOR_FULLY_COVERED_SESSIONS",
        "efficiencyExcludedSessions": len(metrics_list) - len(paired),
    }
