from yazzy.modules.trips.domain import driving_events

ROUTE = [
    {"time": 0, "latitude": 1.0, "longitude": 2.0},
    {"time": 100, "latitude": 1.5, "longitude": 2.5},
]


def ramp(start_time, start_speed, per_second, seconds, step=0.5):
    n = int(seconds / step)
    return [(start_time + i * step, start_speed + per_second * i * step) for i in range(n + 1)]


def test_gentle_driving_has_no_events():
    assert driving_events(ramp(0, 0, 4, 10) + ramp(10, 40, -5, 8), ROUTE) == []


def test_hard_braking_is_one_event_with_the_nearest_position():
    speeds = ramp(0, 60, 0, 5) + ramp(5.5, 60, -18, 3)  # 5 m/s^2 for three seconds
    events = driving_events(speeds, ROUTE)
    assert [e["type"] for e in events] == ["HARD_BRAKING"]
    assert events[0]["peakMetresPerSecond2"] <= -4.9
    assert events[0]["fromKmh"] > events[0]["toKmh"]
    assert (events[0]["latitude"], events[0]["longitude"]) == (1.0, 2.0)


def test_hard_acceleration_and_braking_are_reported_separately():
    speeds = ramp(0, 0, 12, 4) + ramp(4.5, 48, 0, 3) + ramp(8, 48, -20, 2)
    assert [e["type"] for e in driving_events(speeds, ROUTE)] == [
        "HARD_ACCELERATION",
        "HARD_BRAKING",
    ]


def test_no_position_when_there_is_no_gps_fix_nearby():
    events = driving_events(ramp(500, 60, -20, 3), ROUTE)
    assert events and events[0]["latitude"] is None


def test_readings_too_far_apart_are_not_treated_as_acceleration():
    assert driving_events([(0, 0), (10, 100)], ROUTE) == []
