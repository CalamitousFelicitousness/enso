from enso_api.job_models import GenerateParams
from enso_api.recipes.portable import portable_issues, ref_values, rules, settings_issues

REF = "upload:" + "a" * 64


def kinds(issues):
    return [(tuple(item["loc"]), item["type"]) for item in issues]


def test_every_generate_field_is_kept_or_dropped_once():
    keep, drop = set(rules()["keep"]), set(rules()["drop"])
    assert not keep & drop
    assert keep | drop == set(GenerateParams.model_fields)


def test_kept_fields_and_upload_refs_pass():
    request = {"type": "generate", "prompt": "a", "inputs": [REF, ""], "control": [{"image": REF, "override": None}], "grading_lut_file": REF}
    assert portable_issues(request, ("r",)) == []


def test_dropped_and_unknown_fields_are_named():
    found = kinds(portable_issues({"type": "generate", "extra": {"sd_model_checkpoint": "x"}, "script_name": "y", "made_up": 1}, ("r",)))
    assert sorted(found) == [(("r", "extra"), "not_portable"), (("r", "made_up"), "not_portable"), (("r", "script_name"), "not_portable")]


def test_a_picture_field_holds_an_upload_ref_or_nothing():
    request = {
        "inputs": ["data:image/png;base64,AAAA", REF],
        "inits": ["/etc/passwd"],
        "mask": "upload:0123456789abcdef",
        "ip_adapter": [{"images": [REF, "C:/x.png"], "masks": [42]}],
        "control": [{"override": "upload:" + "b" * 64}, {"image": "../a.png"}],
        "grading_lut_file": "/models/luts/a.cube",
    }
    found = kinds(portable_issues(request, ()))
    assert sorted(found) == sorted(
        [
            (("inputs", 0), "not_portable"),
            (("inits", 0), "not_portable"),
            (("mask",), "not_portable"),
            (("ip_adapter", 0, "images", 1), "not_portable"),
            (("ip_adapter", 0, "masks", 0), "not_portable"),
            (("control", 1, "image"), "not_portable"),
            (("grading_lut_file",), "not_portable"),
        ]
    )


def test_ref_values_walks_lists_of_objects():
    request = {"ip_adapter": [{"images": ["a", "b"]}, {"images": ["c"]}, "junk"], "control": "not a list"}
    assert [path for path, _ in ref_values(request, "ip_adapter[].images[]")] == [("ip_adapter", 0, "images", 0), ("ip_adapter", 0, "images", 1), ("ip_adapter", 1, "images", 0)]
    assert ref_values(request, "control[].image") == []


def test_the_settings_snapshot_leaves_out_the_override_box():
    assert kinds(settings_issues({"steps": 4, "overrideSettings": {"outdir_samples": "/tmp"}}, ("s",))) == [(("s", "overrideSettings"), "not_portable")]
