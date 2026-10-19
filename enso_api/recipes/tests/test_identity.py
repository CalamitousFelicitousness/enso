import json
import os

from enso_api.recipes.entry import build_entry
from enso_api.recipes.identity import IdentifyQueue, LocalModel, LocalNetwork, Lookup, ModelHashes, Wanted, file_stat, identify_next, resolve
from enso_api.recipes.tests.helpers import body, recipe_part

DIGEST = "d" * 64
OTHER = "e" * 64


def model_file(root, name="model.safetensors", data=b"weights") -> str:
    path = os.path.join(root, name)
    with open(path, "wb") as f:
        f.write(data)
    return path


def lookup_of(models=(), networks=()):
    by_title = {m.title: m for m in models}
    by_name = {n.name: n for n in networks}
    return Lookup(by_title.get, by_name.get)


def test_the_stored_digest_holds_while_the_file_does(root, db, clock):
    hashes = ModelHashes(db, clock)
    path = model_file(root)
    hashes.put(path, file_stat(path), DIGEST)
    assert hashes.get(path) == DIGEST
    assert hashes.reader()(path) == DIGEST
    with open(path, "ab") as f:
        f.write(b"more")
    assert hashes.get(path) is None
    assert hashes.reader()(path) is None


def test_a_local_model_takes_this_servers_names_and_digest(root, db, clock):
    path = model_file(root)
    local = LocalModel("SDXL/juggernaut [0123456789]", "juggernaut", "SDXL/juggernaut", path, "safetensors", "0123456789", DIGEST)
    sent = {**recipe_part()["checkpoint"], "sha256": OTHER, "name": "renamed"}
    resolved, wanted = resolve({**recipe_part(), "checkpoint": sent}, lookup_of([local]), ModelHashes(db, clock))
    assert resolved["checkpoint"]["sha256"] == DIGEST
    assert resolved["checkpoint"]["name"] == "juggernaut"
    assert wanted == []


def test_an_unhashed_file_is_queued_and_a_missing_one_loses_its_digest(root, db, clock):
    path = model_file(root)
    local = LocalModel("SDXL/juggernaut [0123456789]", "juggernaut", "SDXL/juggernaut", path, "safetensors", "0123456789", None)
    resolved, wanted = resolve(recipe_part(), lookup_of([local]), ModelHashes(db, clock))
    assert resolved["checkpoint"]["sha256"] is None
    assert wanted == [Wanted(path, "checkpoint", "SDXL/juggernaut")]
    absent, _ = resolve({**recipe_part(), "checkpoint": {**recipe_part()["checkpoint"], "sha256": OTHER}}, lookup_of(), ModelHashes(db, clock))
    assert absent["checkpoint"]["sha256"] is None


def test_a_diffusers_snapshot_is_not_a_digest(db, clock):
    local = LocalModel("Diffusers/qwen", "qwen", "Diffusers/qwen", "/nowhere", "diffusers", None, "a" * 40)
    resolved, wanted = resolve({**recipe_part(), "checkpoint": {**recipe_part()["checkpoint"], "title": "Diffusers/qwen"}}, lookup_of([local]), ModelHashes(db, clock))
    assert resolved["checkpoint"]["snapshot"] == "a" * 40
    assert resolved["checkpoint"]["sha256"] is None
    assert wanted == []


def test_a_lora_takes_only_a_full_digest(root, db, clock):
    path = model_file(root, "fur.safetensors")
    short_only = LocalNetwork("fur", path, "abcd1234", "abcd1234")
    resolved, wanted = resolve(recipe_part(), lookup_of(networks=[short_only]), ModelHashes(db, clock))
    assert resolved["networks"][0]["sha256"] is None
    assert resolved["networks"][0]["short"] == "abcd1234"
    assert wanted == [Wanted(path, "network", "fur")]
    cached = LocalNetwork("fur", path, "abcd1234", DIGEST)
    assert resolve(recipe_part(), lookup_of(networks=[cached]), ModelHashes(db, clock))[0]["networks"][0]["sha256"] == DIGEST


def test_the_queue_takes_each_file_once():
    queue = IdentifyQueue()
    assert queue.add([Wanted("/a", "checkpoint", "a"), Wanted("/a", "checkpoint", "a")])
    assert not queue.add([Wanted("/a", "checkpoint", "a")])
    assert queue.take() == Wanted("/a", "checkpoint", "a")
    assert queue.take() is None


def test_identify_hashes_once_and_fills_this_servers_recipes(root, db, clock, entries):
    path = model_file(root)
    part = recipe_part()
    saved, _ = build_entry(body("recipe", recipe=part), "here")
    entries.save(saved, None, False)
    imported, _ = build_entry(body("recipe", recipe=part), "there", origin="file-1")
    entries.save(imported, None, False)
    queue = IdentifyQueue()
    queue.add([Wanted(path, "checkpoint", "SDXL/juggernaut")])
    calls = []

    def hasher(filename):
        calls.append(filename)
        return DIGEST

    assert identify_next(queue, ModelHashes(db, clock), db, hasher, lambda: False) == 1
    assert calls == [path]
    with db.read() as conn:
        rows = dict(conn.execute("SELECT id, recipe FROM entries").fetchall())
    assert json.loads(rows["here"])["checkpoint"]["sha256"] == DIGEST
    assert json.loads(rows["there"])["checkpoint"]["sha256"] is None
    queue.add([Wanted(path, "checkpoint", "SDXL/juggernaut")])
    assert identify_next(queue, ModelHashes(db, clock), db, hasher, lambda: False) == 0
    assert calls == [path]


def test_identify_stops_when_asked(root, db, clock):
    queue = IdentifyQueue()
    queue.add([Wanted(model_file(root), "checkpoint", "x")])
    assert identify_next(queue, ModelHashes(db, clock), db, lambda _f: DIGEST, lambda: True) == 0
    assert queue.take() is not None
