import pytest
from hypothesis import given
from hypothesis import strategies as st

from yazzy.modules.intelligence.domain import trim_finding
from yazzy.modules.telemetry.obd import ElmFrames, approved_command, decode
from yazzy.modules.trips.domain import Observation as O
from yazzy.modules.trips.domain import aggregate, integrate, metrics, segment


def frames(speed, rpm, ignition=1, start=0):
    return [
        O(start + i * 10, signal, value)
        for i, s in enumerate(speed)
        for signal, value in [
            ("VEHICLE_SPEED", s),
            ("ENGINE_RPM", rpm[i]),
            ("IGNITION", ignition),
            ("FUEL_RATE", 1.0 if rpm[i] > 0 else 0.0),
        ]
    ]


def test_stop_start_is_one_trip():
    obs = frames([0, 20, 30, 0, 0, 0, 25, 30, 0], [800, 1600, 1800, 0, 0, 0, 1600, 1800, 0])
    trips = segment(obs, 80)
    assert len(trips) == 1
    assert trips[0]["start"] == 10
    assert trips[0]["status"] == "PAUSED"
    assert metrics(obs, 10, 80)["engineOffStopSeconds"] == 20


def test_hybrid_engine_off_motion_is_not_parking():
    obs = frames([0, 20, 30, 30, 25, 0], [0] * 6)
    assert len(segment(obs, 50)) == 1
    assert segment(obs, 50)[0]["status"] == "PAUSED"


def test_parking_confirmation_backdates_end():
    obs = frames([0, 20, 30], [800, 1500, 1600]) + frames([0] * 21, [0] * 21, 0, start=30)
    trip = segment(obs, 230)[0]
    assert trip["end"] == 30
    assert trip["detected"] == 210
    assert trip["status"] == "CLOSED"


def test_missing_rpm_does_not_end_trip():
    obs = [O(t, "VEHICLE_SPEED", 30) for t in [0, 10, 20]]
    assert segment(obs, 200)[0]["status"] == "UNCERTAIN"


def test_long_gap_not_integrated():
    value, coverage = integrate([(0, 60), (10, 60), (1000, 60), (1010, 60)], 0, 1010)
    assert value == pytest.approx(1 / 3)
    assert coverage == 20


def test_missing_fuel_is_not_zero():
    m = metrics([O(0, "VEHICLE_SPEED", 20), O(10, "VEHICLE_SPEED", 20)], 0, 10)
    assert m["fuelLitres"] is None
    assert m["fuelCoverage"] == 0


def test_stationary_fuel_not_infinite_efficiency():
    m = metrics(frames([0, 0, 0], [800, 800, 800]), 0, 20)
    assert m["fuelLitres"] == pytest.approx(20 / 3600)
    assert m["litresPer100Km"] is None
    assert m["idleEngineSeconds"] == 20


def test_counter_reset_is_not_negative_fuel():
    obs = [O(t, "FUEL_COUNTER", v) for t, v in [(0, 10), (10, 10.1), (20, 0.1), (30, 0.2)]]
    m = metrics(obs, 0, 30, {"validatedFuelCounter": True})
    assert m["fuelLitres"] == pytest.approx(0.2)
    assert m["fuelCoverage"] == pytest.approx(2 / 3)


def test_maf_requires_qualification():
    obs = [O(t, "MAF", 10) for t in [0, 10]]
    assert metrics(obs, 0, 10)["fuelLitres"] is None
    assert metrics(obs, 0, 10, {"qualifiedPetrolMaf": True})["fuelMethod"] == "MAF_ESTIMATE_PETROL"


def test_bad_gps_jumps_are_not_distance():
    def pos(lon):
        return {"latitude": 42.7, "longitude": lon, "accuracy": 3, "validFix": True, "fixAge": 0}

    obs = [O(0, "GPS", pos(23.3)), O(10, "GPS", pos(50))]
    assert metrics(obs, 0, 10)["distanceKm"] is None


def test_weighted_fleet_efficiency():
    base = {
        "durationSeconds": 100,
        "coveredFuelSeconds": 100,
        "coveredDistanceSeconds": 100,
        "idleEngineSeconds": 0,
        "idleFuelLitres": 0,
    }
    total = aggregate(
        [{**base, "distanceKm": 10, "fuelLitres": 1}, {**base, "distanceKm": 100, "fuelLitres": 5}]
    )
    assert total["litresPer100Km"] == pytest.approx(600 / 110)


@given(
    st.floats(min_value=0, max_value=200, allow_nan=False),
    st.floats(min_value=0.1, max_value=15, allow_nan=False),
)
def test_integration_invariant_constant_rate(rate, duration):
    value, covered = integrate([(0, rate), (duration, rate)], 0, duration)
    assert value == pytest.approx(rate * duration / 3600)
    assert covered == duration


@pytest.mark.parametrize(
    "command", ["04", "ATSH7E0", "2E1234", "ATZ\r04", "08", "1101", "executeSql"]
)
def test_obd_forbids_vehicle_writes(command):
    with pytest.raises(ValueError):
        approved_command(command)


def test_elm_partial_echo_multiple_ecu():
    parser = ElmFrames()
    assert parser.feed(b"010C\r41 0C 1A") == []
    responses = parser.feed(b" F8\r>")
    assert decode(responses[0], "010C")[0]["value"] == 1726
    replies = decode("7E8 04 41 0C 1A F8\r7E9 04 41 0C 1B 00", "010C")
    assert len(replies) == 2
    assert decode("NO DATA\r>", "010C") == []
    assert decode("41 0C 1A", "010C") == []
    assert decode("41 05 ZZ", "0105") == []


def test_supported_pid_and_dtc_decode():
    assert decode("41 00 80 00 00 01", "0100")[0]["supportedPids"] == ["01", "20"]
    assert decode("43 01 71 00 00", "03")[0]["value"] == "P0171"


def test_elm_bounded_frame():
    with pytest.raises(ValueError):
        ElmFrames().feed(b"X" * 9000)


def test_baseline_abstains_then_requires_persistence():
    def make(values):
        return [{"trim": x, "startAt": i} for i, x in enumerate(values)]

    assert trim_finding(make([2] * 12))[1] is None
    assert trim_finding(make([2] * 10 + [11] * 2 + [2]))[1] is None
    baseline, finding = trim_finding(make([2] * 10 + [11] * 3))
    assert baseline["status"] == "FROZEN"
    assert finding["probability"] is None
    assert finding["changePercentagePoints"] == 9
    assert trim_finding(make([None] * 20))[0]["status"] == "INSUFFICIENT_DATA"


def test_disconnection_after_single_ignition_off_is_uncertain():
    obs = frames([30, 30], [1500, 1500]) + frames([0], [0], ignition=0, start=20)
    assert segment(obs, 400)[0]["status"] == "UNCERTAIN"


def test_partial_fuel_does_not_bias_efficiency():
    obs = [O(t, "VEHICLE_SPEED", 60) for t in range(0, 61, 10)]
    obs += [O(t, "FUEL_RATE", 6) for t in [0, 10]]
    m = metrics(obs, 0, 60)
    assert m["fuelLitres"] is not None
    assert m["fuelCoverage"] == pytest.approx(1 / 6)
    assert m["litresPer100Km"] is None
    assert aggregate([m])["litresPer100Km"] is None


def test_frozen_reference_survives_retention():
    data, finding = trim_finding([{"trim": 11, "startAt": i} for i in range(3)], reference=[2] * 10)
    assert data["status"] == "FROZEN"
    assert finding["changePercentagePoints"] == 9


def test_simulator_chunking_preserves_exact_observations():
    from simulator.scenarios import packet

    args = ("device", "assignment", "run", 42, 1790841600, 0)
    full = packet(*args, steps=12)
    first = packet(*args, steps=6)
    last = packet(*args, start_step=6, steps=6)
    assert first["samples"] + last["samples"] == full["samples"]


def test_ignition_off_while_standing_still_ends_the_trip():
    obs = frames([0, 20, 30, 10, 0], [800, 1500, 1600, 1000, 800]) + [O(45, "IGNITION", 0)]
    trip = segment(obs, 60)[0]
    assert (trip["status"], trip["endReason"], trip["end"]) == ("CLOSED", "IGNITION_OFF", 40)


def test_ignition_off_while_moving_does_not_end_the_trip():
    # A Bluetooth dropout mid-drive is not the car being switched off.
    obs = frames([0, 20, 30], [800, 1500, 1600]) + [O(25, "IGNITION", 0)]
    assert segment(obs, 30)[0]["status"] == "ACTIVE"


def test_petrol_fuel_is_estimated_from_air_flow_and_trims():
    # 10 g/s of air with +5% short and +5% long trim: 10 / 14.7 * 1.1 g/s of petrol.
    obs = [O(t, "MAF", 10) for t in (0, 10)]
    obs += [O(t, "SHORT_FUEL_TRIM", 5) for t in (0, 10)] + [
        O(t, "LONG_FUEL_TRIM", 5) for t in (0, 10)
    ]
    m = metrics(obs, 0, 10, fuel_type="PETROL")
    assert m["fuelMethod"] == "MAF_ESTIMATE_PETROL"
    assert m["fuelLitres"] == pytest.approx(10 * 10 / 14.7 * 1.1 / 745)
    # Petrol hybrids, and cars whose fuel type was never set, are petrol unless told otherwise.
    assert metrics(obs, 0, 10)["fuelMethod"] == "MAF_ESTIMATE_PETROL"


def test_air_flow_never_estimates_diesel_fuel():
    obs = [O(t, "MAF", 10) for t in (0, 10)] + [O(t, "SHORT_FUEL_TRIM", 0) for t in (0, 10)]
    assert metrics(obs, 0, 10, fuel_type="DIESEL")["fuelLitres"] is None
    # Without fuel trims there is no proof of a petrol mixture.
    assert (
        metrics([O(t, "MAF", 10) for t in (0, 10)], 0, 10, fuel_type="PETROL")["fuelLitres"] is None
    )
    # An explicit capability wins either way.
    assert metrics(obs, 0, 10, {"qualifiedPetrolMaf": False})["fuelLitres"] is None


def test_efficiency_allows_the_seconds_lost_at_each_end_of_a_trip():
    # Speed and fuel rate both start 3 s into a 60 s trip: 95% covered.
    obs = [O(t, "VEHICLE_SPEED", 60) for t in range(3, 61, 3)]
    obs += [O(t, "FUEL_RATE", 6) for t in range(3, 61, 3)]
    m = metrics(obs, 0, 60)
    assert m["fuelCoverage"] == pytest.approx(57 / 60)
    assert m["litresPer100Km"] == pytest.approx(10)
    assert aggregate([m])["litresPer100Km"] == pytest.approx(10)
