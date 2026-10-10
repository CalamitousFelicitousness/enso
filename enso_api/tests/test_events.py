import pytest

from enso_api import events


@pytest.fixture(autouse=True)
def bus(monkeypatch):
    monkeypatch.setattr(events, "versions", {})
    monkeypatch.setattr(events, "logs", {})


def test_a_state_topic_keeps_the_last_data():
    events.bump("settings", trash_days=7)
    events.bump("settings", trash_days=9)
    assert events.current()["settings"] == events.Version(2, {"trash_days": 9})


def test_a_change_topic_unions_ids_across_bumps():
    events.changed("library", ["a"])
    events.changed("library", ["b", "c"])
    events.changed("library", ["a"])
    assert events.since("library", 0) == events.Changes(3, frozenset({"a", "b", "c"}))
    assert events.since("library", 2) == events.Changes(3, frozenset({"a"}))
    assert events.since("library", 3).ids == frozenset()


def test_a_reader_further_behind_than_the_log_gets_none():
    for i in range(events.CHANGE_LOG + 1):
        events.changed("trash", [str(i)])
    assert events.since("trash", 0).ids is None
    assert events.since("trash", 1).ids == frozenset(str(i) for i in range(1, events.CHANGE_LOG + 1))


def test_since_on_an_unknown_topic_is_empty():
    assert events.since("records", 4) == events.Changes(4, frozenset())


def test_pending_owes_one_event_per_moved_topic_and_updates_sent():
    events.bump("settings", trash_days=7)
    events.changed("library", ["a"])
    sent = {topic: version.n for topic, version in events.current().items()}
    assert events.pending(sent) == []
    events.changed("library", ["c"])
    events.changed("library", ["b"])
    events.bump("settings", trash_days=8)
    events.bump("settings", trash_days=9)
    assert events.pending(sent) == [
        {"type": "settings", "data": {"trash_days": 9}},
        {"type": "library", "data": {"ids": ["b", "c"]}},
    ]
    assert sent == {"settings": 3, "library": 3}
    assert events.pending(sent) == []


def test_a_topic_first_bumped_after_connect_is_owed_whole():
    sent: dict[str, int] = {}
    events.changed("records", ["x"])
    events.changed("records", ["y"])
    assert events.pending(sent) == [{"type": "records", "data": {"ids": ["x", "y"]}}]


def test_a_socket_further_behind_than_the_log_is_owed_a_full_read():
    events.changed("trash", ["first"])
    sent = {"trash": 1}
    for i in range(events.CHANGE_LOG + 1):
        events.changed("trash", [str(i)])
    assert events.pending(sent) == [{"type": "trash", "data": {"ids": None}}]
