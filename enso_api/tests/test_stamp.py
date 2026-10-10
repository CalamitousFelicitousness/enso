import time
from types import SimpleNamespace

from enso_api.job_context import active_job
from enso_api.stamp import on_before_image_saved, stamp_in, stamped, strip_stamp, thumb_job

PARAMETERS = "a cat on a mat\nNegative prompt: blur\nSteps: 20, Seed: 1234, Size: 64x64"


def test_a_stamp_follows_a_parameter_line_as_its_last_pair():
    assert stamped(PARAMETERS, "0123abcd") == PARAMETERS + ", Enso job: enso-0123abcd"


def test_a_pairs_only_text_is_stamped():
    assert stamped("Postprocess upscale by: 2, Postprocess upscaler: None", "ab") == "Postprocess upscale by: 2, Postprocess upscaler: None, Enso job: enso-ab"


def test_a_trailing_stamp_is_replaced():
    assert stamped(PARAMETERS + ", Enso job: enso-00aa", "beef01") == PARAMETERS + ", Enso job: enso-beef01"


def test_a_text_without_a_pair_is_left_as_it_is():
    assert stamped("a cat on a mat", "ab") == "a cat on a mat"
    assert stamped("", "ab") == ""


def test_a_stamp_inside_a_prompt_stays_and_the_last_pair_wins():
    text = "pasted: Enso job: enso-aaaa, more words\nSteps: 20"
    result = stamped(text, "bbbb")
    assert result.startswith("pasted: Enso job: enso-aaaa, more words")
    assert stamp_in(result) == "bbbb"


def test_a_quoted_value_before_the_stamp_is_kept_whole():
    text = 'Steps: 20, Wildcards: "a, b, c"'
    result = stamped(text, "cd")
    assert result == text + ", Enso job: enso-cd"
    assert stamp_in(result) == "cd"


def test_strip_removes_only_a_trailing_stamp():
    assert strip_stamp("Steps: 20, Enso job: enso-ab ") == "Steps: 20"
    assert strip_stamp("Enso job: enso-ab") == ""
    assert strip_stamp("x Enso job: enso-ab, Steps: 20") == "x Enso job: enso-ab, Steps: 20"


def test_stamp_in_reads_the_last_stamp_and_nothing_else():
    assert stamp_in("Steps: 20, Enso job: enso-aa, Enso job: enso-bb") == "bb"
    assert stamp_in("Steps: 20, Enso job: other") is None
    assert stamp_in(None) is None


def test_the_stamp_is_preferred_then_the_table_then_nothing():
    assert thumb_job(["Steps: 1", "Steps: 1, Enso job: enso-ab"], lambda: "zz") == ("ab", "stamp")
    assert thumb_job(["Steps: 1", None], lambda: "zz") == ("zz", "table")
    assert thumb_job([None], lambda: None) == (None, None)


def test_an_unclosed_quote_with_a_run_of_backslashes_is_read_in_linear_time():
    text = 'Steps: 20, Wildcards: "' + "\\" * 20000
    start = time.perf_counter()
    result = stamped(text, "ab")
    assert stamp_in(result) == "ab"
    assert stamp_in(text) is None
    assert time.perf_counter() - start < 1.0


def test_the_callback_stamps_the_sections_of_a_running_job_and_strips_the_rest():
    pnginfo = {"parameters": PARAMETERS + ", Enso job: enso-00aa", "extras": "Postprocess upscale by: 2", "postprocessing": "Steps: 1, Enso job: enso-00aa", "size": 3}
    token = active_job.set("c0ffee")
    try:
        on_before_image_saved(SimpleNamespace(pnginfo=pnginfo))
    finally:
        active_job.reset(token)
    assert stamp_in(pnginfo["parameters"]) == "c0ffee"
    assert pnginfo["extras"] == "Postprocess upscale by: 2, Enso job: enso-c0ffee"
    assert pnginfo["postprocessing"] == "Steps: 1"
    assert pnginfo["size"] == 3


def test_the_callback_leaves_a_save_outside_a_job_alone():
    pnginfo = {"parameters": PARAMETERS}
    on_before_image_saved(SimpleNamespace(pnginfo=pnginfo))
    assert pnginfo == {"parameters": PARAMETERS}


def test_the_callback_never_raises():
    token = active_job.set("c0ffee")
    try:
        on_before_image_saved(SimpleNamespace())
    finally:
        active_job.reset(token)
