import json
import logging
import os

import pytest

from enso_api import job_queue as queue_module
from enso_api.job_context import active_job
from enso_api.job_queue import JobQueue
from enso_api.job_store import JobStore
from enso_api.job_warnings import JobLogCapture


class FakeState:
    def __init__(self):
        self.preview = False
        self.fail_preview = False
        self.sampling_step = 0
        self.sampling_steps = 0
        self.job = ""
        self.textinfo = None
        self.current_image = None

    @property
    def disable_preview(self):
        return self.preview

    @disable_preview.setter
    def disable_preview(self, value):
        if self.fail_preview:
            self.fail_preview = False
            raise RuntimeError("preview refused")
        self.preview = value

    def interrupt(self):
        pass


class FakeLock:
    def __init__(self):
        self.fail = False
        self.held = False

    def __enter__(self):
        if self.fail:
            self.fail = False
            raise RuntimeError("lock refused")
        self.held = True

    def __exit__(self, *exc):
        self.held = False


class FakeSdnext:
    def __init__(self):
        self.table: dict | None = {}
        self.state = FakeState()
        self.queue_lock = FakeLock()
        self.displayed: list[str] = []

    @property
    def executors(self) -> dict:
        if self.table is None:
            raise RuntimeError("executors not loaded")
        return self.table

    def display(self, e, title):
        self.displayed.append(f"{title}: {type(e).__name__}")


class RefusingPool:
    def submit(self, *args):
        raise RuntimeError("cannot schedule new futures after shutdown")


class InlinePool:
    def submit(self, fn, *args):
        fn(*args)


def done(params, job_id):
    return {"images": [], "info": {"seed": params.get("seed")}}


def broken(params, job_id):
    raise RuntimeError("executor failed")


@pytest.fixture
def released(monkeypatch):
    names: list[str] = []
    monkeypatch.setattr(queue_module, "release_uploads", names.append)
    monkeypatch.setattr(queue_module, "assign_output_urls", lambda store, result, job_id: 0)
    return names


@pytest.fixture
def queue(root, released):
    sdnext = FakeSdnext()
    sdnext.table = {"generate": {"fn": done, "lock": True}, "cloud": {"fn": done, "lock": False}}
    made = JobQueue(sdnext)
    made.store = JobStore(os.path.join(root, "jobs.db"))
    yield made
    made.store.close()


def turn(queue):
    queue.wake()
    queue.turn()


def capture_handlers():
    return [h for h in logging.getLogger("sd").handlers if isinstance(h, JobLogCapture)]


def assert_unwound(queue, job_id, released):
    assert queue.in_flight == set()
    assert queue.running_job_id is None
    assert not queue.sdnext.state.preview
    assert not queue.sdnext.queue_lock.held
    assert capture_handlers() == []
    assert job_id not in queue.stopped_ids
    assert active_job.get() is None
    assert released.count(job_id) == 1


def test_a_job_runs_and_completes(queue, released):
    job = queue.enqueue("generate", {"seed": 7}, 0, "a")
    assert job == queue.store.get("a")
    turn(queue)
    row = queue.store.get("a")
    assert row["status"] == "completed"
    assert row["result"]["info"] == {"seed": 7}
    assert_unwound(queue, "a", released)


def test_a_failure_before_dispatch_leaves_the_row_pending_and_logs_once(queue, caplog):
    table = queue.sdnext.table
    queue.sdnext.table = None
    queue.enqueue("generate", {}, 0, "a")
    caplog.set_level(logging.ERROR, logger="sd")
    failure = None
    for _ in range(3):
        queue.wake()
        failure = queue.guarded_turn(failure)
    assert failure == "RuntimeError: executors not loaded"
    assert len([r for r in caplog.records if "worker turn failed" in r.message]) == 1
    assert queue.store.get("a")["status"] == "pending"
    queue.sdnext.table = table
    queue.wake()
    assert queue.guarded_turn(failure) is None
    assert queue.store.get("a")["status"] == "completed"


def test_a_failure_logs_again_after_a_clean_turn(queue, caplog):
    caplog.set_level(logging.ERROR, logger="sd")
    queue.sdnext.table = None
    queue.enqueue("generate", {}, 0, "a")
    queue.wake()
    failure = queue.guarded_turn(None)
    queue.store.cancel("a")
    queue.wake()
    failure = queue.guarded_turn(failure)
    assert failure is None
    queue.enqueue("generate", {}, 0, "b")
    queue.wake()
    queue.guarded_turn(failure)
    assert len([r for r in caplog.records if "worker turn failed" in r.message]) == 2


def fail_push_on(queue, monkeypatch, kind):
    """The next event of this kind raises."""
    push = queue.push_progress
    armed = [True]

    def refusing(job_id, data):
        if armed[0] and kind in (data.get("type"), data.get("status")):
            armed[0] = False
            raise RuntimeError(f"{kind} event refused")
        push(job_id, data)

    monkeypatch.setattr(queue, "push_progress", refusing)


@pytest.mark.parametrize("step", ["event", "params", "preview", "lock", "executor"])
def test_a_setup_that_fails_at_any_step_unwinds_what_it_set_up(queue, released, monkeypatch, step):
    queue.enqueue("generate", {}, 0, "a")
    if step == "event":
        fail_push_on(queue, monkeypatch, "running")
    elif step == "params":
        with queue.store.db.write() as w:
            w.conn.execute("UPDATE jobs SET params = '{' WHERE id = 'a'")
    elif step == "preview":
        queue.sdnext.state.fail_preview = True
    elif step == "lock":
        queue.sdnext.queue_lock.fail = True
    else:
        queue.sdnext.table["generate"]["fn"] = broken
    turn(queue)
    row = queue.store.get("a")
    assert row["status"] == "failed"
    assert row["error"]
    assert_unwound(queue, "a", released)
    queue.enqueue("generate", {}, 0, "b")
    queue.sdnext.table["generate"]["fn"] = done
    turn(queue)
    assert queue.store.get("b")["status"] == "completed"


def test_a_completed_job_is_never_marked_failed(queue, released, monkeypatch):
    fail_push_on(queue, monkeypatch, "completed")
    queue.enqueue("generate", {"seed": 3}, 0, "a")
    turn(queue)
    row = queue.store.get("a")
    assert row["status"] == "completed"
    assert row["error"] is None
    assert queue.sdnext.displayed == ["Job queue: generate: RuntimeError"]
    assert_unwound(queue, "a", released)


def test_a_cancel_during_the_run_is_recorded_as_cancelled(queue, released):
    def cancelled_midway(params, job_id):
        queue.cancel(job_id)
        raise RuntimeError("interrupted")

    queue.sdnext.table["generate"]["fn"] = cancelled_midway
    queue.enqueue("generate", {}, 0, "a")
    turn(queue)
    row = queue.store.get("a")
    assert row["status"] == "cancelled"
    assert row["error"] == "RuntimeError: interrupted"
    assert_unwound(queue, "a", released)
    assert queue.stopped_by_user("a") is False


def test_a_job_cancelled_before_its_runner_starts_is_skipped(queue, released):
    calls = []
    queue.sdnext.table["generate"]["fn"] = lambda params, job_id: calls.append(job_id)
    job = queue.enqueue("generate", {}, 0, "a")
    queue.store.cancel("a")
    queue._execute_job(job)
    assert calls == []
    assert queue.store.get("a")["status"] == "cancelled"
    assert_unwound(queue, "a", released)


def test_a_cloud_job_runs_on_the_pool(queue, released):
    queue._cloud_pool = InlinePool()
    queue.enqueue("cloud", {"seed": 5}, 0, "a")
    turn(queue)
    assert queue.store.get("a")["status"] == "completed"
    assert queue.in_flight == set()
    assert released == ["a"]


def test_a_cloud_dispatch_the_pool_refuses_fails_the_job(queue, released):
    queue._cloud_pool = RefusingPool()
    queue.enqueue("cloud", {}, 0, "a")
    turn(queue)
    row = queue.store.get("a")
    assert row["status"] == "failed"
    assert "cannot schedule" in row["error"]
    assert queue.in_flight == set()
    assert released == ["a"]


def test_a_cloud_job_cancelled_while_running_stays_cancelled(queue, released):
    def cancelled_midway(params, job_id):
        assert queue.cancel(job_id)
        return {"images": []}

    queue._cloud_pool = InlinePool()
    queue.sdnext.table["cloud"]["fn"] = cancelled_midway
    queue.enqueue("cloud", {}, 0, "a")
    turn(queue)
    row = queue.store.get("a")
    assert row["status"] == "cancelled"
    assert row["result"] is None


def test_boot_names_every_readable_row(queue, monkeypatch, caplog):
    named = []
    monkeypatch.setattr(queue_module, "name_uploads", lambda job_id, params: named.append(json.loads(params)))
    queue.enqueue("generate", {"seed": 1}, 0, "a")
    queue.enqueue("generate", {"seed": 2}, 0, "b")
    with queue.store.db.write() as w:
        w.conn.execute("UPDATE jobs SET params = '{' WHERE id = 'a'")
    caplog.set_level(logging.WARNING, logger="sd")
    queue.name_live_uploads()
    assert named == [{"seed": 2}]
    assert any("id=a not named" in r.message for r in caplog.records)


def test_the_job_context_names_the_job_while_its_executor_runs(queue, released):
    seen = []

    def record(params, job_id):
        seen.append(active_job.get())
        return {"images": []}

    queue.sdnext.table["generate"]["fn"] = record
    queue.sdnext.table["cloud"]["fn"] = record
    queue._cloud_pool = InlinePool()
    queue.enqueue("generate", {}, 0, "a")
    turn(queue)
    queue.enqueue("cloud", {}, 0, "b")
    turn(queue)
    assert seen == ["a", "b"]
    assert active_job.get() is None
