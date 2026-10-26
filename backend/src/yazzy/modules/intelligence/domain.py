from statistics import median

from yazzy.modules.trips.domain import series


def warm_idle_trim(observations):
    speed, rpm, coolant = [
        series(observations, s) for s in ["VEHICLE_SPEED", "ENGINE_RPM", "COOLANT_TEMP"]
    ]
    accepted = []
    for timestamp, value in series(observations, "SHORT_FUEL_TRIM"):
        context = [
            next((v for t, v in reversed(points) if 0 <= timestamp - t <= 15), None)
            for points in [speed, rpm, coolant]
        ]
        s, r, c = context
        if s is not None and r is not None and c is not None and s <= 1 and r >= 500 and c >= 70:
            accepted.append(value)
    return median(accepted) if len(accepted) >= 3 else None


def trim_finding(windows, reference=None):
    eligible = [w for w in windows if w["trim"] is not None]
    if len(eligible) < (3 if reference else 13):
        return {
            "status": "LEARNING" if eligible else "INSUFFICIENT_DATA",
            "qualifyingWindows": len(eligible),
            **({"reference": reference} if reference else {}),
        }, None
    base = reference or [w["trim"] for w in eligible[:10]]
    center = median(base)
    mad = median(abs(x - center) for x in base)
    recent = eligible[-3:]
    residuals = [w["trim"] - center for w in recent]
    threshold = max(5.0, 4 * 1.4826 * mad)
    changed = all(r > threshold for r in residuals)
    baseline = {
        "status": "FROZEN" if changed else "MONITORING",
        "reference": base,
        "median": center,
        "mad": mad,
        "qualifyingWindows": len(eligible),
    }
    if not changed:
        return baseline, None
    return baseline, {
        "observed": median(w["trim"] for w in recent),
        "reference": center,
        "changePercentagePoints": median(residuals),
        "threshold": threshold,
        "windows": eligible,
        "regime": "WARM_IDLE",
        "probability": None,
        "hypotheses": [{"code": "INTAKE_METERING_OR_FUEL_DELIVERY", "probability": None}],
        "dataQuality": "SUFFICIENT_FOR_TREND",
        "detectorVersion": "warm-idle-median-v1",
        "recommendedNextStep": "Review the recorded fuel compensation change with a qualified technician.",
        "unsupportedClaims": [
            "Exact failed part",
            "Time until failure",
            "Battery cranking minimum",
        ],
    }
