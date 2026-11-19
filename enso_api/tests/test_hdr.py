import importlib
import logging
import sys
import types

import pytest
from PIL import Image


class Unavailable(RuntimeError):
    """Stands in for sdnext's HDRUnavailable."""

    def __init__(self, code: str, reason: str):
        super().__init__(reason)
        self.code = code
        self.reason = reason


@pytest.fixture
def hdr(monkeypatch):
    """enso_api.hdr, which imports sdnext's logger when loaded."""
    logger = types.ModuleType("modules.logger")
    logger.log = logging.getLogger("sd")
    monkeypatch.setitem(sys.modules, "modules", types.ModuleType("modules"))
    monkeypatch.setitem(sys.modules, "modules.logger", logger)
    return importlib.import_module("enso_api.hdr")


@pytest.fixture
def postprocess(hdr, monkeypatch):  # pylint: disable=redefined-outer-name,unused-argument
    """enso_api.postprocess with a router that registers nothing: the test venv has no FastAPI."""
    fastapi = types.ModuleType("fastapi")
    fastapi.APIRouter = lambda **kwargs: types.SimpleNamespace(get=lambda *args, **kwargs: lambda route: route)
    monkeypatch.setitem(sys.modules, "fastapi", fastapi)
    return importlib.import_module("enso_api.postprocess")


@pytest.fixture
def step(monkeypatch):
    """sdnext's HDR step: writes nothing, keeps each call, and raises what a path is given in `fail`."""
    calls: list[tuple] = []
    fail: dict[str, Exception] = {}

    def convert_hdr(image, output, method, peak, gamut):  # pylint: disable=unused-argument
        calls.append((output, method, peak, gamut))
        if output in fail:
            raise fail[output]
        return output.rsplit(".", 1)[0] + "-hdr.png"

    module = types.ModuleType("scripts.hdr.hdr_process")
    module.HDRUnavailable = Unavailable
    module.convert_hdr = convert_hdr
    monkeypatch.setitem(sys.modules, "scripts", types.ModuleType("scripts"))
    monkeypatch.setitem(sys.modules, "scripts.hdr", types.ModuleType("scripts.hdr"))
    monkeypatch.setitem(sys.modules, "scripts.hdr.hdr_process", module)
    return types.SimpleNamespace(calls=calls, fail=fail)


def outputs(*paths: str) -> list[tuple[Image.Image, str]]:
    return [(Image.new("RGB", (4, 4)), path) for path in paths]


@pytest.mark.parametrize("mode", ["image", "batch", "folder"])
def test_hdr_never_reaches_the_runner(postprocess, mode):  # pylint: disable=redefined-outer-name
    args, _ = postprocess.build_script_args({"mode": mode, "hdr": {"hdr_peak": 2000}, "pixelart": {}})
    assert "PixelArt" in args
    assert "HDR" not in args


def test_the_hdr_model_has_the_scripts_controls(postprocess):  # pylint: disable=redefined-outer-name
    assert postprocess.typed_control_names("HDR") == {"hdr_method", "hdr_peak", "hdr_gamut"}


def test_each_saved_output_gets_its_hdr_file(hdr, step):  # pylint: disable=redefined-outer-name
    written = hdr.write(outputs("/out/1-a.png", "/out/2-b.png"), {"hdr_peak": 4000, "hdr_gamut": "DCI-P3"})
    assert written == ["/out/1-a-hdr.png", "/out/2-b-hdr.png"]
    assert step.calls == [("/out/1-a.png", "Algorithmic", 4000.0, "DCI-P3"), ("/out/2-b.png", "Algorithmic", 4000.0, "DCI-P3")]


@pytest.mark.parametrize(
    ("error", "message"),
    [
        (Unavailable("encoder-missing", "ultrahdr_app is not installed"), "ultrahdr_app is not installed"),
        (ValueError("HDR: method=None unsupported"), "method=None unsupported"),
    ],
)
def test_a_refusal_stops_at_the_first_output_with_one_warning(hdr, step, caplog, error, message):  # pylint: disable=redefined-outer-name
    caplog.set_level(logging.WARNING, logger="sd")
    step.fail["/out/1-a.png"] = error
    assert not hdr.write(outputs("/out/1-a.png", "/out/2-b.png"), {})
    assert len(step.calls) == 1
    assert [r.getMessage() for r in caplog.records] == [f"HDR: no HDR file was written: {message}"]


def test_a_failed_write_skips_that_output_alone(hdr, step, caplog):  # pylint: disable=redefined-outer-name
    caplog.set_level(logging.WARNING, logger="sd")
    step.fail["/out/1-a.png"] = OSError("disk full")
    assert hdr.write(outputs("/out/1-a.png", "/out/2-b.png"), {}) == ["/out/2-b-hdr.png"]
    assert [r.getMessage() for r in caplog.records] == ['HDR: no HDR file for "/out/1-a.png": disk full']


def test_a_server_without_the_step_writes_nothing_and_says_so(hdr, monkeypatch, caplog):  # pylint: disable=redefined-outer-name
    caplog.set_level(logging.WARNING, logger="sd")
    monkeypatch.setitem(sys.modules, "scripts.hdr.hdr_process", None)
    assert not hdr.write(outputs("/out/1-a.png"), {})
    assert [r.getMessage() for r in caplog.records] == ["HDR: no HDR file was written: this sdnext has no HDR step"]


def test_the_info_line_names_one_file_and_counts_several(hdr):  # pylint: disable=redefined-outer-name
    assert hdr.note(["/out/1-a-hdr.png"]) == "HDR: 1-a-hdr.png"
    assert hdr.note(["/out/1-a-hdr.png", "/out/2-b-hdr.png"]) == "HDR: 2 files"


def test_an_empty_hdr_request_with_saving_off_says_why_nothing_was_written(hdr, step, caplog):  # pylint: disable=redefined-outer-name
    caplog.set_level(logging.WARNING, logger="sd")
    assert hdr.after_save({}, "image", False, [], "Size: 8x8, ") == "Size: 8x8, "
    assert not step.calls
    assert [r.getMessage() for r in caplog.records] == ["HDR: no HDR file was written: the output is not saved"]


@pytest.mark.parametrize("mode", ["folder", "video"])
def test_a_run_without_its_own_saves_writes_no_hdr_and_says_so(hdr, step, caplog, mode):  # pylint: disable=redefined-outer-name
    caplog.set_level(logging.WARNING, logger="sd")
    assert hdr.after_save({}, mode, True, outputs("/out/1-a.png"), "") == ""
    assert not step.calls
    assert [r.getMessage() for r in caplog.records] == [f"HDR: no HDR file was written: a {mode} run takes no HDR"]


@pytest.mark.parametrize(("info", "line"), [("Size: 8x8, ", "Size: 8x8, HDR: 1-a-hdr.png"), ("", "HDR: 1-a-hdr.png")])
def test_the_info_line_gains_the_hdr_file(hdr, step, info, line):  # pylint: disable=redefined-outer-name,unused-argument
    assert hdr.after_save({}, "image", True, outputs("/out/1-a.png"), info) == line


def test_a_generation_writes_hdr_beside_each_saved_output(hdr, step):  # pylint: disable=redefined-outer-name
    assert hdr.after_generate(["Algorithmic", 1000, "Rec.2020"], True, outputs("/out/1-a.png", "/out/2-b.png")) == ["/out/1-a-hdr.png", "/out/2-b-hdr.png"]
    assert step.calls == [("/out/1-a.png", "Algorithmic", 1000.0, "Rec.2020"), ("/out/2-b.png", "Algorithmic", 1000.0, "Rec.2020")]


@pytest.mark.parametrize("method", [None, "", "None"])
def test_a_generation_with_hdr_mapping_off_writes_nothing(hdr, step, caplog, method):  # pylint: disable=redefined-outer-name
    caplog.set_level(logging.WARNING, logger="sd")
    assert hdr.after_generate([method, 1000, "Rec.2020"], False, outputs("/out/1-a.png")) == []
    assert not step.calls
    assert not caplog.records


def test_an_unsaved_generation_writes_no_hdr_and_says_so(hdr, step, caplog):  # pylint: disable=redefined-outer-name
    caplog.set_level(logging.WARNING, logger="sd")
    assert hdr.after_generate(["Algorithmic", 1000, "Rec.2020"], False, outputs("/tmp/1-a.png")) == []
    assert not step.calls
    assert [r.getMessage() for r in caplog.records] == ["HDR: no HDR file was written: the output is not saved"]
