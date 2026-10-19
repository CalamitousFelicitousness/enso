from enso_api.media.models import EntryBodyV2
from enso_api.media.tests.helpers import png, put
from enso_api.recipes.recipe import RECIPE_SCHEMA


def held(store, *seeds: int) -> list[str]:
    return [put(store, png(seed))[0].hash for seed in seeds]


def lut_bytes(seed: int = 0) -> bytes:
    return f'TITLE "t{seed}"\nLUT_3D_SIZE 2\n'.encode() + b"0 0 0\n1 1 1\n" * 4


def recipe_part(**overrides) -> dict:
    part = {
        "recipe_schema": RECIPE_SCHEMA,
        "request": {"type": "generate", "prompt": "a cat <lora:fur:0.6>", "negative_prompt": "", "steps": 20, "width": 704, "height": 1280},
        "refs": {},
        "map_keys": [],
        "settings": {"steps": 20},
        "checkpoint": {"title": "SDXL/juggernaut [0123456789]", "name": "juggernaut", "path": "SDXL/juggernaut", "sha256": None, "shorthash": "0123456789", "snapshot": None, "class_name": "StableDiffusionXLPipeline", "type": "safetensors"},
        "networks": [{"kind": "lora", "name": "fur", "sha256": None, "short": None}],
        "lut": None,
        "preview": None,
    }
    return {**part, **overrides}


def body(kind: str = "recipe", hashes: dict[str, str] | None = None, recipe: dict | None = None, thumbs=(), inputs: dict | None = None) -> EntryBodyV2:
    hashes = hashes or {}
    frames = {"schema": 3, "size": {"width": 8, "height": 8}, "sizeSource": None, "frames": [{"id": "f1", "pictures": [{"cid": cid, "name": f"{cid}.png"} for cid in hashes]}]}
    return EntryBodyV2(
        kind=kind,
        name="Portrait",
        summary={"frames": 1 if hashes else 0, "pictures": len(hashes), "role": None, "control": None, "width": 8, "height": 8, "inputs_schema": 3},
        inputs=inputs if inputs is not None else (frames if hashes or kind != "recipe" else None),
        hashes=hashes,
        thumbs=list(thumbs),
        recipe=recipe,
    )
