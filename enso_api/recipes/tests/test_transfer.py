import json
import os
import zipfile

import pytest

from enso_api.media.tests.helpers import png, put
from enso_api.recipes import pack, transfer
from enso_api.recipes.entry import build_entry
from enso_api.recipes.models import MIME
from enso_api.recipes.tests.helpers import body, lut_bytes, recipe_part

NEVER = lambda: False


def stored_recipe(store, entries, entry_id="r1"):
    """A recipe in the library with two pictures, a mask in its request, a LUT, a thumbnail and a preview."""
    picture, other, mask = (put(store, png(seed))[0].hash for seed in (1, 2, 3))
    thumb, preview = (put(store, png(seed, 4))[0].hash for seed in (4, 5))
    lut = put(store, lut_bytes())[0].hash
    request = {"type": "generate", "prompt": "<lora:fur:1>", "inputs": [f"upload:{picture}"], "mask": f"upload:{mask}", "grading_lut_file": f"upload:{lut}"}
    part = recipe_part(request=request, refs={f"upload:{mask}": {"kind": "mask", "frameId": "f1", "drawnAt": {"width": 8, "height": 8}}}, lut={"name": "warm.cube"}, preview={"thumb": preview, "width": 4, "height": 4})
    thumbs = [{"cid": "p1", "hash": picture, "thumb": thumb, "width": 8, "height": 8}]
    entry, issues = build_entry(body("recipe", hashes={"p1": picture, "p2": other}, recipe=part, thumbs=thumbs), entry_id)
    assert issues == []
    entries.save(entry, "alice", False)
    return {"picture": picture, "other": other, "mask": mask, "thumb": thumb, "preview": preview, "lut": lut}


def export(store, entries, entry_id="r1"):
    entry, manifest_id = transfer.stored_entry(entries, entry_id)
    packed = transfer.pack_entry(store, entry, manifest_id, "test", NEVER)
    return store.layout.export_path(packed.id), packed


def into_part(store, path):
    """The file as an import's part under tmp/, as the route leaves it."""
    part = store.layout.new_part()
    with open(path, "rb") as src, open(part, "wb") as dst:
        dst.write(src.read())
    return part


def rewrite(path, out, change):
    """A copy of a recipe file with its members changed by `change(name, data) -> list of (name, data, compress)`."""
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(out, "w") as dst:
        for info in src.infolist():
            for name, data, compress in change(info.orig_filename, src.read(info)):
                dst.writestr(zipfile.ZipInfo(name, pack.EPOCH), data, compress_type=compress)
    return out


def manifest_change(fn):
    def change(name, data):
        if name == pack.MANIFEST:
            return [(name, json.dumps(fn(json.loads(data))).encode(), zipfile.ZIP_DEFLATED)]
        return [(name, data, zipfile.ZIP_STORED)]

    return change


def test_an_export_holds_every_named_blob_stored(store, entries):
    held = stored_recipe(store, entries)
    path, packed = export(store, entries)
    with zipfile.ZipFile(path) as zf:
        infos = zf.infolist()
        assert infos[0].orig_filename == "mimetype" and infos[0].compress_type == zipfile.ZIP_STORED
        assert zf.read("mimetype").decode() == MIME
        manifest = json.loads(zf.read("recipe.json"))
        blobs = {info.orig_filename.split("/")[1].split(".")[0]: info for info in infos[2:]}
    assert set(blobs) == set(held.values())
    assert all(info.compress_type == zipfile.ZIP_STORED for info in blobs.values())
    assert manifest["id"] == "r1" and manifest["kind"] == "recipe" and "maps" not in manifest
    assert packed.name == "Portrait.enso" and packed.blobs == len(held)


def test_an_import_on_another_server_holds_every_blob(store, entries, other):
    held = stored_recipe(store, entries)
    path, _ = export(store, entries)
    imported = transfer.unpack_entry(other.store, other.entries, into_part(other.store, path), "bob")
    assert imported.created and imported.added == len(held)
    assert other.store.held(held.values()) == set(held.values())
    whole = other.entries.get(imported.entry["id"])
    assert whole["recipe"]["lut"] == {"name": "warm.cube"}
    assert set(whole["hashes"].values()) == {held["picture"], held["other"]}
    assert not set(whole["hashes"]) & {"p1", "p2"}
    assert {thumb["cid"] for thumb in whole["thumbs"]} <= set(whole["hashes"])
    assert other.entries.origin_of(imported.entry["id"]) == "r1"


def test_a_second_import_answers_the_first(store, entries, other):
    stored_recipe(store, entries)
    path, _ = export(store, entries)
    first = transfer.unpack_entry(other.store, other.entries, into_part(other.store, path), None)
    again = transfer.unpack_entry(other.store, other.entries, into_part(other.store, path), None)
    assert not again.created and again.entry["id"] == first.entry["id"] and again.added == 0


def test_a_round_trip_comes_home_as_the_same_entry(store, entries, other):
    stored_recipe(store, entries)
    path, _ = export(store, entries)
    imported = transfer.unpack_entry(other.store, other.entries, into_part(other.store, path), None)
    entry, manifest_id = transfer.stored_entry(other.entries, imported.entry["id"])
    back = transfer.pack_entry(other.store, entry, manifest_id, "test", NEVER)
    home = transfer.unpack_entry(store, entries, into_part(store, other.store.layout.export_path(back.id)), None)
    assert not home.created and home.entry["id"] == "r1"


def test_an_export_of_the_same_entry_differs_only_in_its_time(store, entries, clock):
    stored_recipe(store, entries)
    first, _ = export(store, entries)
    clock.advance(1000)
    second, _ = export(store, entries)
    with zipfile.ZipFile(first) as a, zipfile.ZipFile(second) as b:
        ma, mb = json.loads(a.read("recipe.json")), json.loads(b.read("recipe.json"))
        assert ma.pop("exported_at") != mb.pop("exported_at")
        assert ma == mb
        assert [i.orig_filename for i in a.infolist()] == [i.orig_filename for i in b.infolist()]


def test_a_cancelled_export_leaves_nothing(store, entries):
    stored_recipe(store, entries)
    entry, manifest_id = transfer.stored_entry(entries, "r1")
    with pytest.raises(pack.Refusal) as caught:
        transfer.pack_entry(store, entry, manifest_id, "test", lambda: True)
    assert caught.value.code == "cancelled"
    assert os.listdir(store.layout.exports) == []


TAMPERS = {
    "renamed member": lambda name, data: [(name.replace("blobs/", "blobs/0") if name.startswith("blobs/") and name.endswith(".cube") else name, data, zipfile.ZIP_STORED)],
    "extra member": lambda name, data: [(name, data, zipfile.ZIP_STORED), *([("notes.txt", b"hi", zipfile.ZIP_STORED)] if name == "mimetype" else [])],
    "climbing name": lambda name, data: [("../" + name if name.endswith(".cube") else name, data, zipfile.ZIP_STORED)],
    "deflated blob": lambda name, data: [(name, data, zipfile.ZIP_DEFLATED if name.startswith("blobs/") else zipfile.ZIP_STORED)],
    "mimetype second": lambda name, data: [] if name == "mimetype" else [(name, data, zipfile.ZIP_STORED), *([("mimetype", MIME.encode(), zipfile.ZIP_STORED)] if name == "recipe.json" else [])],
}
CODES = {"renamed member": "stray_member", "extra member": "stray_member", "climbing name": "stray_member", "deflated blob": "damaged", "mimetype second": "not_recipe"}


@pytest.mark.parametrize("tamper", sorted(TAMPERS))
def test_a_tampered_file_is_refused_and_places_nothing(store, entries, other, root, tamper):
    stored_recipe(store, entries)
    path, _ = export(store, entries)
    bad = rewrite(path, os.path.join(root, "bad.enso"), TAMPERS[tamper])
    with pytest.raises(pack.Refusal) as caught:
        transfer.unpack_entry(other.store, other.entries, into_part(other.store, bad), None)
    assert caught.value.code == CODES[tamper]
    with other.db.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM blobs").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0] == 0


def test_a_member_that_is_not_its_hash_places_nothing(store, entries, other, root):
    held = stored_recipe(store, entries)
    path, _ = export(store, entries)
    forged = png(99)

    def change(name, data):
        if name == f"blobs/{held['other']}.png":
            return [(name, forged + b"\0" * (len(data) - len(forged)) if len(forged) < len(data) else forged[: len(data)], zipfile.ZIP_STORED)]
        return [(name, data, zipfile.ZIP_STORED)]

    bad = rewrite(path, os.path.join(root, "bad.enso"), change)
    upload = into_part(other.store, bad)
    with pytest.raises(pack.Refusal) as caught:
        transfer.unpack_entry(other.store, other.entries, upload, None)
    assert caught.value.code == "hash_mismatch"
    with other.db.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM blobs").fetchone()[0] == 0
    # Only the upload's own part is left, which the route removes
    assert os.listdir(other.store.layout.tmp) == [os.path.basename(upload)]


@pytest.mark.parametrize(
    ("fn", "code"),
    [
        (lambda m: {**m, "version": 2}, "newer_recipe"),
        (lambda m: {**m, "surprise": 1}, "bad_manifest"),
        (lambda m: {**m, "format": "other"}, "not_recipe"),
        (lambda m: {**m, "recipe": {**m["recipe"], "request": {**m["recipe"]["request"], "extra": {"sd_model_checkpoint": "x"}}}}, "not_portable"),
        (lambda m: {**m, "recipe": {**m["recipe"], "recipe_schema": 9}}, "newer_recipe"),
    ],
)
def test_a_manifest_the_rules_refuse(store, entries, other, root, fn, code):
    stored_recipe(store, entries)
    path, _ = export(store, entries)
    bad = rewrite(path, os.path.join(root, "bad.enso"), manifest_change(fn))
    with pytest.raises(pack.Refusal) as caught:
        transfer.unpack_entry(other.store, other.entries, into_part(other.store, bad), None)
    assert caught.value.code == code


def test_a_named_blob_missing_from_the_file(store, entries, other, root):
    held = stored_recipe(store, entries)
    path, _ = export(store, entries)
    bad = rewrite(path, os.path.join(root, "bad.enso"), lambda name, data: [] if name.startswith(f"blobs/{held['lut']}") else [(name, data, zipfile.ZIP_STORED)])
    with pytest.raises(pack.Refusal) as caught:
        transfer.unpack_entry(other.store, other.entries, into_part(other.store, bad), None)
    assert caught.value.code == "member_missing"


def test_a_picture_over_the_limit_is_refused(store, entries, other):
    # The limit is each server's own: a 16.8 MP picture leaves a server that takes it and is refused by one at 16 MP
    other.store.update_settings({"max_input_pixels": 16_000_000})
    big = put(store, png(7, 4100))[0].hash
    part = recipe_part(request={"type": "generate", "prompt": "<lora:fur:1>", "inputs": [f"upload:{big}"]})
    entry, _ = build_entry(body("recipe", recipe=part), "big")
    entries.save(entry, None, False)
    path, _ = export(store, entries, "big")
    with pytest.raises(pack.Refusal) as caught:
        transfer.unpack_entry(other.store, other.entries, into_part(other.store, path), None)
    assert caught.value.code == "too_large"
    assert caught.value.fields["width"] == 4100


def test_not_a_zip(other, root):
    path = os.path.join(root, "junk.enso")
    with open(path, "wb") as f:
        f.write(b"not a zip at all" * 10)
    with pytest.raises(pack.Refusal) as caught:
        transfer.unpack_entry(other.store, other.entries, into_part(other.store, path), None)
    assert caught.value.code == "not_recipe"


def test_a_directory_past_the_bound_is_refused_before_it_is_read(root, monkeypatch):
    path = os.path.join(root, "many.zip")
    with zipfile.ZipFile(path, "w") as zf:
        for i in range(5):
            zf.writestr(f"m{i}", b"x")
    monkeypatch.setattr(pack, "MEMBERS_MAX", 2)
    with pytest.raises(pack.Refusal) as caught:
        pack.check_directory(path)
    assert caught.value.code == "damaged"


def test_remint_renames_every_picture_consistently():
    manifest = {"inputs": {"frames": [{"pictures": [{"cid": "a"}, {"cid": "b"}], "mask": {"objects": [{"cid": "a"}]}}]}, "hashes": {"a": "1", "b": "2"}, "unavailable": ["b"], "thumbs": [{"cid": "a"}]}
    fresh = pack.remint(manifest)
    pictures = fresh["inputs"]["frames"][0]["pictures"]
    new_a, new_b = pictures[0]["cid"], pictures[1]["cid"]
    assert {new_a, new_b}.isdisjoint({"a", "b"})
    assert fresh["inputs"]["frames"][0]["mask"]["objects"][0]["cid"] == new_a
    assert fresh["hashes"] == {new_a: "1", new_b: "2"}
    assert fresh["unavailable"] == [new_b] and fresh["thumbs"][0]["cid"] == new_a


def test_file_names_lose_controls_and_separators():
    assert pack.file_name("a/b:c" + chr(0x202E) + "d") == "a-b-cd.enso"
    assert pack.file_name("   ") == "recipe.enso"
