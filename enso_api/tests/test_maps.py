import importlib
import logging
import os
import sys
import types
from collections import OrderedDict

import pytest
from PIL import Image

from enso_api import preprocess
from enso_api.job_queue import job_queue
from enso_api.media import boot
from enso_api.media.tests.conftest import db, layout, store  # pylint: disable=unused-import
from enso_api.media.tests.helpers import png


@pytest.fixture
def executors(monkeypatch):
    """enso_api.executors, which imports sdnext's logger when loaded."""
    logger = types.ModuleType("modules.logger")
    logger.log = logging.getLogger("sd")
    monkeypatch.setitem(sys.modules, "modules", types.ModuleType("modules"))
    monkeypatch.setitem(sys.modules, "modules.logger", logger)
    return importlib.import_module("enso_api.executors")


class Processor:
    """Stands in for preprocess.run: every run makes a map of its own colour, or fails when told to."""

    def __init__(self):
        self.calls: list[dict] = []
        self.during = None
        self.failing = False

    def __call__(self, processor_id, image, params):
        self.calls.append(params)
        if self.during:
            self.during()
        if self.failing:
            raise preprocess.ProcessorFailed(processor_id, "no edges")
        return Image.new("RGB", image.size, (len(self.calls), 0, 0))


@pytest.fixture
def processor(monkeypatch, store):  # noqa: F811  # pylint: disable=redefined-outer-name
    made = Processor()
    monkeypatch.setattr(preprocess, "run", made)
    monkeypatch.setattr(preprocess, "release", lambda: None)
    monkeypatch.setattr(preprocess, "defaults", {"Canny": {"low": 100, "high": 200}})
    monkeypatch.setattr(preprocess, "maps_made", OrderedDict())
    monkeypatch.setattr(boot.state, "store", store)
    monkeypatch.setattr(job_queue, "stopped_ids", set())
    return made


@pytest.fixture
def events(monkeypatch):
    sent: list[tuple[str, dict]] = []
    monkeypatch.setattr(job_queue, "push_maps", lambda job_id, data: sent.append((job_id, data)))
    return sent


def picture(media, seed: int) -> str:
    row, _ = media.ingest_bytes(png(seed))
    return f"upload:{row.hash}"


def slot(key: str, sent, params: dict | None = None, applied: list | None = None) -> dict:
    return {"key": key, "process": "Canny", "params": params or {}, "source": Image.new("RGB", (8, 8)), "sent": sent, "apply": applied.append if applied is not None else lambda image: None}


def test_a_stop_while_a_processor_runs_keeps_its_map_and_runs_no_other(executors, processor, events, store, monkeypatch):  # noqa: F811  # pylint: disable=redefined-outer-name
    monkeypatch.setattr(job_queue, "_current_job_id", "a")
    processor.during = job_queue.note_user_stop
    applied: list = []
    maps, failed = executors.run_processors("a", [slot("k1", picture(store, 1), applied=applied), slot("k2", picture(store, 2), applied=applied)])
    assert len(processor.calls) == 1
    assert list(maps) == ["k1"]
    assert failed == {}
    assert len(applied) == 1
    assert events == [("a", {"type": "maps", "maps": maps, "failed": {}})]


def test_a_later_job_takes_the_map_an_earlier_one_made(executors, processor, events, store):  # noqa: F811  # pylint: disable=redefined-outer-name
    sent = picture(store, 1)
    first, _ = executors.run_processors("a", [slot("k", sent)])
    store.release_job("a")
    applied: list = []
    # parameters equal to the defaults name the same map as none
    again, failed = executors.run_processors("b", [slot("k", sent, {"low": 100}, applied)])
    assert len(processor.calls) == 1
    assert again == first
    assert failed == {}
    assert applied[0].getpixel((0, 0)) == (1, 0, 0)
    assert store.jobs_named() == {"b"}
    assert events[1] == ("b", {"type": "maps", "maps": first, "failed": {}})


def test_other_parameters_or_another_picture_make_a_map_of_their_own(executors, processor, events, store):  # noqa: F811  # pylint: disable=redefined-outer-name
    sent = picture(store, 1)
    first, _ = executors.run_processors("a", [slot("k", sent)])
    other_params, _ = executors.run_processors("b", [slot("k", sent, {"low": 50})])
    other_picture, _ = executors.run_processors("c", [slot("k", picture(store, 2))])
    inline, _ = executors.run_processors("d", [slot("k", "data:image/png;base64,AAAA")])
    assert len(processor.calls) == 4
    assert len({first["k"], other_params["k"], other_picture["k"], inline["k"]}) == 4


def test_a_map_the_store_no_longer_holds_is_made_again(executors, processor, events, store):  # noqa: F811  # pylint: disable=redefined-outer-name
    sent = picture(store, 1)
    first, _ = executors.run_processors("a", [slot("k", sent)])
    store.release_job("a")
    os.remove(store.path_of(first["k"].rsplit("/", 1)[1]))
    again, _ = executors.run_processors("b", [slot("k", sent)])
    assert len(processor.calls) == 2
    assert again != first
    assert list(preprocess.maps_made.values()) == [again["k"].rsplit("/", 1)[1]]


def test_one_job_makes_each_map_once(executors, processor, events, store):  # noqa: F811  # pylint: disable=redefined-outer-name
    sent = picture(store, 1)
    applied: list = []
    maps, _ = executors.run_processors("a", [slot("k1", sent, applied=applied), slot("k2", sent, applied=applied)])
    assert len(processor.calls) == 1
    assert maps["k1"] == maps["k2"]
    assert applied[0] is applied[1]
    processor.failing = True
    other = picture(store, 2)
    _, failed = executors.run_processors("b", [slot("k1", other), slot("k2", other)])
    assert len(processor.calls) == 2
    assert failed == {"k1": "Canny: no edges", "k2": "Canny: no edges"}


def test_the_newest_maps_are_kept(monkeypatch):
    monkeypatch.setattr(preprocess, "maps_made", OrderedDict())
    monkeypatch.setattr(preprocess, "MAPS_KEPT", 2)
    preprocess.remember("a", "1")
    preprocess.remember("b", "2")
    assert preprocess.recall("a") == "1"
    preprocess.remember("c", "3")
    assert list(preprocess.maps_made) == ["a", "c"]
    assert preprocess.recall("b") is None
