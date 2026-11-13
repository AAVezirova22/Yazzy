from yazzy.modules.trips.domain import Observation as O
from yazzy.modules.trips.service import JOURNEY_GAP_SECONDS, split_on_gaps


def reading(t):
    return O(t, "ENGINE_RPM", 800)


def test_silence_longer_than_the_gap_starts_a_new_journey():
    observations = [reading(t) for t in (0, 1, 2, 100, 101)]
    observations += [reading(t) for t in (101 + JOURNEY_GAP_SECONDS + 1, 300)]
    chunks = split_on_gaps(observations)
    assert [[o.time for o in c] for c in chunks] == [[0, 1, 2, 100, 101], [222.0, 300]]


def test_short_gaps_and_unsorted_input_stay_one_journey():
    observations = [reading(t) for t in (50, 0, 30, 110)]
    assert len(split_on_gaps(observations)) == 1


def test_empty_input_has_no_journeys():
    assert split_on_gaps([]) == []
