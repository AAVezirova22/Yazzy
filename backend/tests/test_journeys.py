from yazzy.modules.trips.domain import Observation as O
from yazzy.modules.trips.service import BRIDGE_SECONDS, SHUTDOWN_GAP_SECONDS, split_on_gaps


def reading(t):
    return O(t, "ENGINE_RPM", 800)


def speed(t, v):
    return O(t, "VEHICLE_SPEED", v)


def times(chunks):
    return [[o.time for o in c] for c in chunks]


def test_switching_off_before_a_silence_ends_the_journey():
    observations = [speed(0, 30), speed(100, 0), O(125, "IGNITION", 0), speed(400, 0), speed(410, 20)]
    assert times(split_on_gaps(observations)) == [[0, 100, 125], [400, 410]]


def test_a_silence_while_driving_stays_one_trip():
    # The Bluetooth link dropped at 50 km/h for five minutes: the car was not switched off.
    observations = [speed(0, 40), speed(100, 50), speed(400, 45), speed(410, 50)]
    assert len(split_on_gaps(observations)) == 1


def test_a_short_wait_without_switch_off_stays_one_trip():
    observations = [speed(0, 30), speed(100, 0), speed(100 + SHUTDOWN_GAP_SECONDS - 60, 0), speed(700, 30)]
    assert len(split_on_gaps(observations)) == 1


def test_standing_and_silent_long_enough_means_switched_off():
    observations = [speed(0, 30), speed(100, 0), speed(100 + SHUTDOWN_GAP_SECONDS + 1, 10)]
    assert len(split_on_gaps(observations)) == 2


def test_very_long_silences_always_split():
    observations = [speed(0, 40), speed(100, 50), speed(100 + BRIDGE_SECONDS + 1, 50)]
    assert len(split_on_gaps(observations)) == 2


def test_silence_without_speed_readings_splits_after_the_shutdown_gap():
    observations = [reading(t) for t in (0, 1, 2, 100, 101)] + [reading(t) for t in (101 + SHUTDOWN_GAP_SECONDS + 1, 800)]
    assert len(split_on_gaps(observations)) == 2


def test_short_gaps_and_unsorted_input_stay_one_journey():
    observations = [reading(t) for t in (50, 0, 30, 110)]
    assert len(split_on_gaps(observations)) == 1


def test_empty_input_has_no_journeys():
    assert split_on_gaps([]) == []
