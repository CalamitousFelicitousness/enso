"""The recipe file of each version a build reads, made from synthetic content; ENSO_WRITE_GOLDEN=1 writes them again."""

import json
import os
import re
import zipfile

import pytest

from enso_api.media.tests.helpers import png, put
from enso_api.recipes import pack, transfer
from enso_api.recipes.entry import build_entry
from enso_api.recipes.models import VERSION
from enso_api.recipes.tests.helpers import body, lut_bytes, recipe_part

HASH = re.compile(r"[0-9a-f]{64}")
FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def golden(version: int) -> str:
    return os.path.join(FIXTURES, f"recipe-v{version}.enso")


def build_v1(store, entries) -> str:
    picture = put(store, png(1))[0].hash
    thumb = put(store, png(2, 4))[0].hash
    lut = put(store, lut_bytes())[0].hash
    request = {"type": "generate", "prompt": "a lighthouse <lora:example:0.5>", "steps": 20, "width": 704, "height": 1280, "inputs": [f"upload:{picture}"], "grading_lut_file": f"upload:{lut}"}
    checkpoint = {"title": "Example/model [0123456789]", "name": "model", "path": "Example/model", "sha256": None, "shorthash": "0123456789", "snapshot": None, "class_name": None, "type": "safetensors"}
    part = recipe_part(request=request, checkpoint=checkpoint, networks=[{"kind": "lora", "name": "example", "sha256": None, "short": None}], lut={"name": "warm.cube"})
    thumbs = [{"cid": "p1", "hash": picture, "thumb": thumb, "width": 8, "height": 8}]
    entry, issues = build_entry(body("recipe", hashes={"p1": picture}, recipe=part, thumbs=thumbs), "golden-v1")
    assert issues == []
    entries.save(entry, None, False)
    stored, manifest_id = transfer.stored_entry(entries, "golden-v1")
    packed = transfer.pack_entry(store, stored, manifest_id, "golden", lambda: False)
    return store.layout.export_path(packed.id)


def manifest(path: str) -> dict:
    with zipfile.ZipFile(path) as zf:
        return json.loads(zf.read(pack.MANIFEST))


def shape(value):
    """A manifest with its hashes numbered by first appearance, so an encoder's change of bytes does not count."""
    seen: dict[str, str] = {}

    def walk(item):
        if isinstance(item, dict):
            return {walk(key): walk(inner) for key, inner in item.items()}
        if isinstance(item, list):
            return [walk(inner) for inner in item]
        if isinstance(item, str):
            for digest in HASH.findall(item):
                item = item.replace(digest, seen.setdefault(digest, f"<{len(seen)}>"))
        return item

    return walk(value)


def test_the_builder_makes_the_committed_file(store, entries):
    built = build_v1(store, entries)
    if os.environ.get("ENSO_WRITE_GOLDEN"):
        os.makedirs(FIXTURES, exist_ok=True)
        with open(built, "rb") as src, open(golden(1), "wb") as dst:
            dst.write(src.read())
    assert shape(manifest(built)) == shape(manifest(golden(1)))


@pytest.mark.parametrize("version", range(1, VERSION + 1))
def test_every_version_still_imports(other, version):
    part = other.store.layout.new_part()
    with open(golden(version), "rb") as src, open(part, "wb") as dst:
        dst.write(src.read())
    imported = transfer.unpack_entry(other.store, other.entries, part, None)
    assert imported.created
    assert other.entries.get(imported.entry["id"])["recipe"]["lut"] == {"name": "warm.cube"}
    assert manifest(golden(version))["version"] == version
