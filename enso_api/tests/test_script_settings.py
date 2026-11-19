import pytest

from enso_api import sdnext_features
from enso_api.script_settings import Runner, Script, ScriptsRejected, call, listed_args, place


@pytest.fixture(autouse=True)
def dlss_fixed(monkeypatch):
    """An sdnext whose DLSS second pass keeps each image's seed."""
    monkeypatch.setattr(sdnext_features, "dlss_second_pass", lambda: True)


NUDENET = ("NudeNet enabled", "Check language", "Check policy violations", "Check banned words", "Update metadata", "Save copy", "Sensitivity", "Block size")
DLSS = ("DLSS Operations", "NR profile", "FG profile", "FG mode", "FG factor", "FG scene threshold", "Video codec", "Video format", "Pixel format", "FFmpeg options")
HDR = ("HDR mapping", "HDR peak brightness", "HDR color gamut")


def runner() -> Runner:
    """Position 0 picks the selectable script; then Loopback (2), NudeNet, DLSS, HDR and IP Adapters (1)."""
    defaults = [0, 4, 0.5, False, False, False, False, True, False, 0.2, 3, [], "Standard", "None", "fps", 2, 0.4, "libx264", "mp4", "yuv420p", "crf=18", "None", 1000, "Rec.2020", 1]
    return Runner(
        defaults=tuple(defaults),
        selectable={"loopback": Script(1, 3, ("Loops", "Strength"), number=2)},
        always_on={
            "nudenet": Script(3, 11, NUDENET),
            "nvidia dlss": Script(11, 21, DLSS),
            "hdr": Script(21, 24, HDR),
            "ip adapters": Script(24, 25, ("Active IP adapters",)),
        },
    )


def test_nothing_sent_keeps_every_default():
    args, own = place(runner(), "", [], {})
    assert args == list(runner().defaults)
    assert own == {}


def test_a_selectable_script_runs_with_untouched_settings():
    args, _ = place(runner(), "Loopback", [], {})
    assert args[0] == 2
    assert args[1:3] == [4, 0.5]


def test_none_keeps_a_settings_default():
    args, _ = place(runner(), "loopback", [None, 0.8], {})
    assert args[1:3] == [4, 0.8]


def test_a_script_the_server_lacks_is_refused():
    with pytest.raises(ScriptsRejected, match='No script "Ultimate" on this server'):
        place(runner(), "Ultimate", [], {})


def test_held_settings_keep_their_default():
    args, _ = place(runner(), "", [], {"nudenet": {"args": [True, None, None, None, None, True, 0.5]}})
    assert args[3] is True
    assert args[8] is False  # Save copy
    assert args[9] == 0.5


def test_an_always_on_script_enso_does_not_run_is_refused():
    with pytest.raises(ScriptsRejected, match='"ip adapters" script does not run from Enso'):
        place(runner(), "", [], {"ip adapters": {"args": [2]}})


def test_an_always_on_script_the_server_lacks_is_refused():
    with pytest.raises(ScriptsRejected, match='No always-on script "story mode"'):
        place(runner(), "", [], {"story mode": {"args": [True]}})


def test_a_narrowed_choice_is_refused():
    with pytest.raises(ScriptsRejected, match='"DLSS Operations" takes NeuralRender or SuperRes, not FrameGen'):
        place(runner(), "", [], {"nvidia dlss": {"args": [["SuperRes", "FrameGen"]]}})


def test_an_allowed_choice_is_placed_and_framegen_stays_off():
    args, _ = place(runner(), "", [], {"nvidia dlss": {"args": [["NeuralRender"], "Fast", "Quality", "slowmo"]}})
    assert args[11] == ["NeuralRender"]
    assert args[12] == "Fast"
    assert args[13:15] == ["None", "fps"]


def test_hdr_runs_as_enso_s_own_step():
    args, own = place(runner(), "", [], {"hdr": {"args": ["Algorithmic", None, "DCI-P3"]}})
    assert args[21:24] == ["None", 1000, "Rec.2020"]
    assert own == {"hdr": ["Algorithmic", 1000, "DCI-P3"]}


def test_more_settings_than_the_script_takes_are_refused():
    with pytest.raises(ScriptsRejected, match='"loopback" script takes 2 settings; 3 were sent'):
        place(runner(), "loopback", [1, 2, 3], {})


def test_a_rule_naming_a_setting_the_script_lacks_refuses_it():
    renamed = runner()
    renamed.always_on["nudenet"] = Script(3, 11, tuple("Keep copy" if label == "Save copy" else label for label in NUDENET))
    with pytest.raises(ScriptsRejected, match='has no "Save copy" setting'):
        place(renamed, "", [], {"nudenet": {"args": [True]}})


def arg(label, value=None, choices=None):
    return {"label": label, "value": value, "choices": choices}


def test_listing_leaves_out_scripts_enso_does_not_run():
    assert listed_args("ip adapters", [arg("Active IP adapters", 1)]) is None


def test_listing_marks_held_settings_and_narrows_choices():
    listed = listed_args("nvidia dlss", [arg("DLSS Operations", [], ["NeuralRender", "SuperRes", "FrameGen"]), *(arg(label) for label in DLSS[1:])])
    assert listed[0]["choices"] == ["NeuralRender", "SuperRes"]
    assert [a["label"] for a in listed if a["fixed"]] == list(DLSS[2:])


def test_listing_leaves_out_a_script_missing_a_rule_label():
    assert listed_args("nudenet", [arg(label) for label in NUDENET if label != "Save copy"]) is None


def test_call_passes_keywords_and_the_settings_tail():
    def run(state="", prompt="", steps=20, *script_args, seed_only=None):  # pylint: disable=keyword-arg-before-vararg
        return state, prompt, steps, script_args, seed_only

    assert call(run, {"prompt": "cat", "seed_only": 7}, [0, "x"]) == ("", "cat", 20, (0, "x"), 7)


def test_dlss_on_an_sdnext_without_its_seed_fix_is_left_out_and_refused(monkeypatch):
    monkeypatch.setattr(sdnext_features, "dlss_second_pass", lambda: False)
    assert listed_args("nvidia dlss", [arg(label) for label in DLSS]) is None
    with pytest.raises(ScriptsRejected, match='to run the "nvidia dlss" script from Enso'):
        place(runner(), "", [], {"nvidia dlss": {"args": [["NeuralRender"]]}})
