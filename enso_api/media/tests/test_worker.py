import threading

import pytest

from enso_api import events
from enso_api.media.worker import MediaWorker, VerifyState, publish_media


@pytest.fixture
def workers():
    started = []

    def make(**steps):
        worker = MediaWorker(**{"reconcile": lambda walk: None, "collect": lambda: None, "verify": lambda cancel, progress: None, "interval": 0.01, **steps})
        started.append(worker)
        worker.start()
        return worker

    yield make
    for worker in started:
        worker.stop()
        worker.join(5)


def wait_for(condition, timeout: float = 5.0) -> bool:
    done = threading.Event()
    for _ in range(int(timeout * 100)):
        if condition():
            return True
        done.wait(0.01)
    return condition()


def test_a_failing_step_is_logged_and_the_loop_goes_on(workers, caplog):
    calls = []

    def collect():
        calls.append(len(calls))
        if len(calls) == 1:
            raise RuntimeError("first pass fails")

    workers(collect=collect)
    assert wait_for(lambda: len(calls) >= 3)
    assert "collection failed: RuntimeError: first pass fails" in caplog.text


def test_verify_runs_once_at_a_time_and_reports_progress(workers):
    release = threading.Event()
    states = []

    def verify(cancel, progress):
        progress(0, 2)
        release.wait(5)
        progress(2, 2)

    worker = workers(verify=verify, on_progress=states.append)
    assert worker.request_verify()
    assert not worker.request_verify()
    assert wait_for(lambda: worker.verify_state() == VerifyState(True, 0, 2))
    release.set()
    assert wait_for(lambda: not worker.verify_state().running)
    assert worker.verify_state() == VerifyState(False, 2, 2)
    assert states[-1] == VerifyState(False, 2, 2)
    assert worker.request_verify()


def test_cancel_reaches_a_running_verify(workers):
    started = threading.Event()

    def verify(cancel, progress):
        started.set()
        cancel.wait(5)

    worker = workers(verify=verify)
    worker.request_verify()
    assert started.wait(5)
    worker.cancel_verify()
    assert wait_for(lambda: not worker.verify_state().running)


def test_reconcile_walks_after_a_verify(workers):
    walks = []
    passes = []
    worker = workers(reconcile=walks.append, collect=lambda: passes.append(1))
    assert wait_for(lambda: len(passes) >= 2)
    assert walks == []
    worker.request_verify()
    assert wait_for(lambda: walks == [True])


def test_events_count_per_topic_and_keep_the_last_data():
    first = events.bump("test-topic", n=1)
    second = events.bump("test-topic", n=2)
    assert second == first + 1
    assert events.current()["test-topic"].data == {"n": 2}


def test_a_verify_payload_survives_a_pass_publish(monkeypatch):
    monkeypatch.setattr(events, "versions", {})
    publish_media(VerifyState(True, 5, 10))
    publish_media()
    assert events.current()["media"] == events.Version(2, {"verify": {"running": True, "checked": 5, "total": 10}})


def test_the_first_media_event_carries_an_idle_verify(monkeypatch):
    monkeypatch.setattr(events, "versions", {})
    publish_media()
    assert events.current()["media"].data == {"verify": {"running": False, "checked": 0, "total": 0}}
