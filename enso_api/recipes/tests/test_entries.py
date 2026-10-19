import json

import pytest

from enso_api.media.entries import EntryPatch, Refused
from enso_api.media.tests.helpers import put
from enso_api.recipes.entry import build_entry
from enso_api.recipes.tests.helpers import body, held, lut_bytes, recipe_part


def entry_in(entry_body, entry_id, origin=None):
    entry, issues = build_entry(entry_body, entry_id, origin=origin)
    assert issues == []
    return entry


def saved(entries, entry_id, part, hashes=None, origin=None):
    return entries.save(entry_in(body("recipe", hashes=hashes, recipe=part), entry_id, origin=origin), "alice", False)


def test_a_recipe_names_what_its_request_names(entries, store):
    picture, composite = held(store, 1, 2)
    lut = put(store, lut_bytes())[0].hash
    part = recipe_part(request={"type": "generate", "prompt": "<lora:fur:1>", "inputs": [f"upload:{composite}"], "grading_lut_file": f"upload:{lut}"}, lut={"name": "warm.cube"})
    changed = saved(entries, "r1", part, {"p": picture})
    assert changed.created
    for digest in (picture, composite, lut):
        assert store.row(digest).unnamed_since is None
    with store.db.read() as conn:
        assert {row[0] for row in conn.execute("SELECT hash FROM entry_blobs WHERE entry_id = 'r1'")} == {picture, composite, lut}


def test_a_request_ref_the_store_lacks_is_refused(entries, store):
    part = recipe_part(request={"type": "generate", "prompt": "<lora:fur:1>", "inputs": ["upload:" + "c" * 64]})
    with pytest.raises(Refused) as caught:
        saved(entries, "r1", part)
    assert [issue["type"] for issue in caught.value.issues] == ["upload_missing"]
    assert caught.value.issues[0]["loc"] == ["body", "recipe", "request", "inputs", 0]


def test_lists_carry_the_head_and_get_the_whole_part(entries, store):
    (thumb,) = held(store, 3)
    part = recipe_part(preview={"thumb": thumb, "width": 4, "height": 4})
    saved(entries, "r1", part)
    (item,) = entries.list(False)
    assert item["recipe"]["checkpoint"]["name"] == "juggernaut"
    assert item["recipe"]["preview"] == {"thumb": thumb, "width": 4, "height": 4, "lost": False}
    assert "request" not in item["recipe"]
    whole = entries.get("r1")
    assert whole["recipe"]["request"]["steps"] == 20
    assert whole["inputs"] is None


def test_a_frame_lists_without_a_recipe(entries, store):
    (picture,) = held(store, 4)
    entries.save(entry_in(body("frame", hashes={"p": picture}), "f1"), None, False)
    assert entries.list(False)[0]["recipe"] is None
    assert entries.get("f1")["recipe"] is None


def test_an_origin_answers_the_entry_it_came_from(entries):
    first = saved(entries, "r1", recipe_part())
    again = saved(entries, "r2", recipe_part(), origin="r1")
    assert not again.created and again.matched_origin and again.entry["id"] == "r1"
    imported = saved(entries, "r3", recipe_part(), origin="file-9")
    twice = saved(entries, "r4", recipe_part(), origin="file-9")
    assert imported.created and twice.entry["id"] == "r3"
    assert first.created
    entries.patch("r3", EntryPatch(trashed=True), None)
    assert saved(entries, "r5", recipe_part(), origin="file-9").created


def test_the_origin_is_what_an_export_carries(entries):
    saved(entries, "r1", recipe_part())
    saved(entries, "r2", recipe_part(), origin="file-9")
    assert entries.origin_of("r1") == "r1"
    assert entries.origin_of("r2") == "file-9"


def test_the_recipe_is_stored_as_written(entries, db):
    saved(entries, "r1", recipe_part())
    with db.read() as conn:
        raw, head = conn.execute("SELECT recipe, recipe_head FROM entries WHERE id = 'r1'").fetchone()
    assert json.loads(raw)["settings"] == {"steps": 20}
    assert "settings" not in json.loads(head)
