import sys
import types

import pytest
from PIL import Image

from enso_api.job_queue import JobStopped, job_queue
from enso_api.media.tests.conftest import db, layout, store  # pylint: disable=unused-import
from enso_api.tests.test_maps import events, executors, picture, processor  # pylint: disable=unused-import


@pytest.fixture
def preprocess_job(executors, monkeypatch):  # noqa: F811  # pylint: disable=redefined-outer-name
    """execute_preprocess with sdnext's state and decoder stood in for."""
    shared = types.ModuleType("modules.shared")
    shared.state = types.SimpleNamespace(begin=lambda *args, **kwargs: "job", end=lambda jobid: None)
    monkeypatch.setitem(sys.modules, "modules.shared", shared)
    monkeypatch.setattr(executors, "decode_image", lambda ref: Image.new("RGB", (8, 8)))
    return executors.execute_preprocess


def items(media, count: int) -> dict:
    return {"items": [{"key": f"k{i}", "process": "Canny", "image": picture(media, i)} for i in range(count)]}


def test_process_now_stopped_before_its_first_map_ends_stopped(preprocess_job, processor, events, store, monkeypatch):  # noqa: F811  # pylint: disable=redefined-outer-name
    monkeypatch.setattr(job_queue, "stopped_ids", {"a"})
    with pytest.raises(JobStopped):
        preprocess_job(items(store, 2), "a")
    assert processor.calls == []


def test_process_now_stopped_after_a_map_completes_with_it(preprocess_job, processor, events, store, monkeypatch):  # noqa: F811  # pylint: disable=redefined-outer-name
    monkeypatch.setattr(job_queue, "_current_job_id", "a")
    processor.during = job_queue.note_user_stop
    result = preprocess_job(items(store, 2), "a")
    assert list(result["maps"]) == ["k0"]


@pytest.mark.parametrize("wanted", [True, False])
def test_a_video_job_stopped_before_it_saved_anything_ends_stopped(executors, monkeypatch, wanted):  # noqa: F811  # pylint: disable=redefined-outer-name
    monkeypatch.setattr(job_queue, "stopped_ids", {"a"})
    with pytest.raises(JobStopped):
        executors.require_saved("a", [], wanted)
    executors.require_saved("a", [{"path": "a.mp4"}], wanted)


def test_a_video_job_that_saved_nothing_it_was_asked_to_fails(executors, monkeypatch):  # noqa: F811  # pylint: disable=redefined-outer-name
    monkeypatch.setattr(job_queue, "stopped_ids", set())
    with pytest.raises(executors.GenerationFailed):
        executors.require_saved("a", [], True)
    executors.require_saved("a", [], False)
