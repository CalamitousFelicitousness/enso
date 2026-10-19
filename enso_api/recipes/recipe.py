"""The rules of a recipe part: what it may name, what it must match in its own request, and what a list item shows.

The request stays opaque beyond these rules; /submit validates it as a job when the recipe runs.
"""

import json
import re
from dataclasses import dataclass, field

from enso_api.documents import HASH_RE, REF_PREFIX, Loc, issue, ref_locations
from enso_api.recipes.portable import portable_issues, settings_issues

RECIPE_SCHEMA = 1
RECIPE_TYPES = ("generate",)
REQUEST_MAX = 1 << 20
SETTINGS_MAX = 256 << 10
NETWORK_RE = re.compile(r"<(lora|lyco):([^:>]+)(?::[^>]*)?>", re.IGNORECASE)


def networks_in(*texts: str) -> set[tuple[str, str]]:
    """The (kind, name) of every <lora:name:weight> and <lyco:name> tag in the texts, sdnext's syntax."""
    return {(kind.lower(), name.strip()) for text in texts if isinstance(text, str) for kind, name in NETWORK_RE.findall(text)}


@dataclass(frozen=True)
class RecipeCheck:
    """What a recipe part names once it passes: the hashes of its request's refs and its preview."""

    names: frozenset[str]
    locations: dict[str, list[Loc]] = field(default_factory=dict)
    issues: tuple[dict, ...] = ()


def size_of(value) -> int:
    return len(json.dumps(value, separators=(",", ":")))


def check_recipe(recipe: dict, loc: Loc = ("body", "recipe")) -> RecipeCheck:
    """The rules a recipe part meets wherever it is written: a save, an import."""
    found: list[dict] = []
    request = recipe["request"]
    schema = recipe["recipe_schema"]
    if schema > RECIPE_SCHEMA:
        found.append(issue((*loc, "recipe_schema"), f"Made by a newer version of Enso (recipe {schema}; this one reads {RECIPE_SCHEMA})", "newer_recipe", schema))
    if size_of(request) > REQUEST_MAX:
        found.append(issue((*loc, "request"), "The request is larger than a recipe keeps", "too_big", REQUEST_MAX))
    if size_of(recipe["settings"]) > SETTINGS_MAX:
        found.append(issue((*loc, "settings"), "The settings are larger than a recipe keeps", "too_big", SETTINGS_MAX))
    job_type = request.get("type")
    if job_type not in RECIPE_TYPES:
        found.append(issue((*loc, "request", "type"), "Only an image generation is kept as a recipe", "recipe_type", job_type if isinstance(job_type, str) else None))
    found.extend(portable_issues(request, (*loc, "request")))
    found.extend(settings_issues(recipe["settings"], (*loc, "settings")))

    names: set[str] = set()
    locations: dict[str, list[Loc]] = {}
    for path, ref_id in ref_locations(request):
        if HASH_RE.fullmatch(ref_id):
            names.add(ref_id)
            locations.setdefault(ref_id, []).append((*loc, "request", *path))
        else:
            found.append(issue((*loc, "request", *path), "A picture in a recipe is an upload ref", "not_portable", f"{REF_PREFIX}{ref_id}"))
    refs = {f"{REF_PREFIX}{ref_id}" for _, ref_id in ref_locations(request)}
    found.extend(issue((*loc, "refs", key), "This ref is not in the request", "unknown_ref", key) for key in recipe["refs"] if key not in refs)
    lut_file = request.get("grading_lut_file")
    if recipe["lut"] is not None and not (isinstance(lut_file, str) and lut_file.startswith(REF_PREFIX)):
        found.append(issue((*loc, "lut"), "The request names no LUT", "unknown_lut", recipe["lut"]["name"]))
    named = networks_in(request.get("prompt", ""), request.get("negative_prompt", ""))
    found.extend(issue((*loc, "networks", i), "The prompt does not name this LoRA", "unknown_network", network["name"]) for i, network in enumerate(recipe["networks"]) if (network["kind"], network["name"].strip()) not in named)
    preview = recipe["preview"]
    if preview is not None:
        names.add(preview["thumb"])
        locations.setdefault(preview["thumb"], []).append((*loc, "preview", "thumb"))
    return RecipeCheck(frozenset(names), locations, tuple(found))


def head_of(recipe: dict) -> dict:
    """What a list item shows of a recipe, without its request."""
    return {
        "recipe_schema": recipe["recipe_schema"],
        "type": recipe["request"].get("type"),
        "checkpoint": recipe["checkpoint"],
        "networks": recipe["networks"],
        "lut": recipe["lut"],
        "preview": recipe["preview"],
    }
