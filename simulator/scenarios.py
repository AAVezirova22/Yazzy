import math
import random
from datetime import UTC, datetime
from typing import Any

SCENARIOS = [
    "CITY",
    "STOP_START",
    "MISSING_SENSORS",
    "GPS_LOSS",
    "DRIFT_HISTORY",
    "RECOVERY",
    "OFFLINE",
    "DUPLICATES",
    "OUT_OF_ORDER",
]
UNITS = {
    "VEHICLE_SPEED": "km/h",
    "ENGINE_RPM": "rpm",
    "COOLANT_TEMP": "degC",
    "SHORT_FUEL_TRIM": "%",
    "FUEL_RATE": "L/h",
    "MODULE_VOLTAGE": "V",
    "IGNITION": "bool",
    "GPS": "deg",
}


def packet(
    device_id,
    assignment_id,
    run_id,
    seed,
    start,
    index,
    day=0,
    scenario="CITY",
    start_step=0,
    steps=61,
):
    samples: list[dict[str, Any]] = []
    for step in range(start_step, start_step + steps):
        rng = random.Random(seed + index * 1009 + day * 101 + step * 1000003)
        phase = (step * 10) % 610
        moving = 30 <= phase < 170 or 210 <= phase < 350
        speed = 36 + 8 * math.sin(phase / 40 + index) if moving else 0
        rpm = 0 if 170 <= phase < 210 or phase >= 400 else 750 + speed * 33
        fuel = 0 if rpm == 0 else 0.75 + speed * 0.045
        drift = (
            scenario in {"DRIFT_HISTORY", "RECOVERY"}
            and 10 <= day <= (13 if scenario == "RECOVERY" else 99)
            and index % 4 == 0
        )
        trim = (11 if drift else 2) + rng.uniform(-0.3, 0.3)
        values = {
            "VEHICLE_SPEED": round(speed, 3),
            "ENGINE_RPM": round(rpm),
            "COOLANT_TEMP": min(90, 25 + phase * 0.2),
            "SHORT_FUEL_TRIM": round(trim, 3),
            "FUEL_RATE": round(fuel, 4),
            "MODULE_VOLTAGE": 14.1 if rpm else 12.6,
            "IGNITION": 0 if phase >= 400 else 1,
            "GPS": {
                "latitude": 42.690 + index * 0.002 + min(phase, 350) * 0.000008,
                "longitude": 23.310 + index * 0.001 + min(phase, 350) * 0.000012,
                "accuracy": 4,
                "fixAge": 0,
                "validFix": True,
                "provider": "SIMULATOR",
            },
        }
        if scenario == "MISSING_SENSORS" and index % 3 == 0:
            values.pop("FUEL_RATE")
            values.pop("SHORT_FUEL_TRIM")
        if scenario == "GPS_LOSS" and 120 <= phase <= 300:
            values.pop("GPS")
        timestamp = start + day * 86400 + step * 10
        for signal_index, (signal, value) in enumerate(values.items()):
            # Signal identity has a fixed slot; missing sensors cannot renumber other samples.
            seq = step * len(UNITS) + list(UNITS).index(signal)
            samples.append(
                {
                    "sequence": seq,
                    "observedAt": datetime.fromtimestamp(timestamp, UTC).isoformat(),
                    "monotonicMs": step * 10000,
                    "signal": signal,
                    "value": value,
                    "unit": UNITS[signal],
                    "quality": "VALID",
                }
            )
    return {
        "schemaVersion": 1,
        "batchId": f"{run_id}-{index}-{day}-{start_step}",
        "deviceId": device_id,
        "assignmentId": assignment_id,
        "sessionId": f"{run_id}-car{index}-day{day}",
        "sequenceStart": min(s["sequence"] for s in samples),
        "source": "SIMULATED_FLEET",
        "platform": "SIMULATOR",
        "decoderVersion": "synthetic-v1",
        "simulationRunId": run_id,
        "scenarioVersion": "1",
        "scenarioSeed": seed,
        "samples": samples,
    }
