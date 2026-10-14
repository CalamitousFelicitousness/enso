from enso_api.size_rules import declared, server_formats

QWEN = {"rule": {"kind": "area", "area": 1048576, "multiple": 32, "round": "nearest"}, "output_area": 1048576}
JOY = {"rule": {"kind": "buckets", "sizes": [[1792, 512], [1024, 1024]], "fit": "cover", "ratio": "h/w", "aspect_multiple": 1}}
FLUX2 = {"rule": {"kind": "cap", "area": 1048576}, "limits": {"min_side": 64, "max_aspect": 8.0}}


def test_declarations_read_as_sdnext_answers_them():
    qwen = declared("q", lambda: QWEN)
    assert qwen is not None and qwen.rule.kind == "area" and qwen.output_area == 1048576
    assert declared("j", lambda: JOY).rule.sizes == [[1792, 512], [1024, 1024]]
    assert declared("f", lambda: FLUX2).limits.max_aspect == 8.0
    assert declared("n", lambda: {"rule": None}).rule is None


def test_an_sdnext_without_the_accessor_or_with_an_unknown_shape_has_said_nothing(caplog):
    def missing():
        raise ImportError("no accessor")

    assert declared("missing", missing) is None
    assert declared("odd", lambda: {"rule": {"kind": "spiral", "turns": 3}}) is None
    assert declared("odd", lambda: {"rule": {"kind": "spiral", "turns": 3}}) is None
    assert caplog.text.count("odd answered in an unknown shape") == 1


def test_the_formats_are_the_kinds_this_pillow_opens():
    formats = server_formats()
    assert {"png", "jpeg", "webp", "gif", "bmp", "tiff"} <= set(formats)
    assert set(formats) <= {"png", "jpeg", "webp", "gif", "bmp", "tiff", "avif", "heic", "jp2", "jxl"}
