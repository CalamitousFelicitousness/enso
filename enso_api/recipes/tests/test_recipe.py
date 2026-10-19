import pytest

from enso_api.recipes.entry import build_entry
from enso_api.recipes.recipe import RECIPE_SCHEMA, REQUEST_MAX, check_recipe, head_of, networks_in
from enso_api.recipes.tests.helpers import body, recipe_part

A = "a" * 64
B = "b" * 64


def types(check):
    return sorted(item["type"] for item in check.issues)


def test_networks_in_reads_sdnext_tags():
    assert networks_in("<lora:a:0.8> x <lyco:B> <LORA:c d:0.5:0.3> <lora:unclosed", "<lora:a:1>") == {("lora", "a"), ("lyco", "B"), ("lora", "c d")}


def test_a_recipe_names_its_request_refs_and_preview():
    part = recipe_part(request={"type": "generate", "prompt": "<lora:fur:1>", "inputs": [f"upload:{A}"]}, preview={"thumb": B, "width": 4, "height": 4})
    check = check_recipe(part)
    assert check.issues == ()
    assert check.names == {A, B}
    assert check.locations[A] == [("body", "recipe", "request", "inputs", 0)]


@pytest.mark.parametrize(
    ("change", "kind"),
    [
        ({"request": {"type": "detail", "prompt": ""}}, "recipe_type"),
        ({"request": {"type": "generate", "prompt": "", "extra": {"sd_vae": "x"}}}, "not_portable"),
        ({"request": {"type": "generate", "prompt": "", "inputs": ["upload:0123456789abcdef"]}}, "not_portable"),
        ({"refs": {f"upload:{A}": {"kind": "file"}}}, "unknown_ref"),
        ({"lut": {"name": "a.cube"}}, "unknown_lut"),
        ({"networks": [{"kind": "lora", "name": "other", "sha256": None, "short": None}]}, "unknown_network"),
        ({"settings": {"overrideSettings": {}}}, "not_portable"),
        ({"recipe_schema": RECIPE_SCHEMA + 1}, "newer_recipe"),
        ({"request": {"type": "generate", "prompt": "x" * REQUEST_MAX}}, "too_big"),
    ],
)
def test_the_rules_refuse(change, kind):
    part = {**recipe_part(networks=[]), **change}
    assert kind in types(check_recipe(part))


def test_a_lut_needs_its_ref_in_the_request():
    part = recipe_part(request={"type": "generate", "prompt": "<lora:fur:1>", "grading_lut_file": f"upload:{A}"}, lut={"name": "warm.cube"})
    assert check_recipe(part).issues == ()


def test_head_leaves_the_request_out():
    head = head_of(recipe_part())
    assert head["type"] == "generate"
    assert "request" not in head and "settings" not in head


def test_kinds_and_their_parts():
    assert [i["type"] for i in build_entry(body("recipe", recipe=None), "e")[1]] == ["recipe_kind"]
    assert [i["type"] for i in build_entry(body("set", hashes={"p": A}, recipe=recipe_part()), "e")[1]] == ["recipe_kind"]
    entry, found = build_entry(body("recipe", recipe=recipe_part()), "e")
    assert found == [] and entry.inputs is None and entry.recipe_head["type"] == "generate"
