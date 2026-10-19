"""What a recipe's request may carry: the fields it keeps, the fields it drops, and the fields that name pictures,
which hold an upload ref or nothing.

One list for the browser and the server, src/lib/recipes/portable.json, read from the extension's own checkout.
"""

import functools
import json
import os
import re

from enso_api.documents import REF_PREFIX, Loc, issue

PORTABLE_JSON = os.path.join(os.path.dirname(__file__), "..", "..", "src", "lib", "recipes", "portable.json")
HASH_REF_RE = re.compile(rf"{REF_PREFIX}[0-9a-f]{{64}}")


@functools.cache
def rules() -> dict:
    with open(PORTABLE_JSON, encoding="utf-8") as f:
        return json.load(f)


def ref_values(request: dict, field: str) -> list[tuple[Loc, object]]:
    """The values at one ref field of the list, `name[]` for every item of a list and `a[].b` through a list of objects."""
    found: list[tuple[Loc, object]] = [((), request)]
    for part in field.split("."):
        many = part.endswith("[]")
        key = part[:-2] if many else part
        step: list[tuple[Loc, object]] = []
        for path, value in found:
            if not isinstance(value, dict) or key not in value:
                continue
            inner = value[key]
            if many:
                if isinstance(inner, list):
                    step.extend(((*path, key, i), item) for i, item in enumerate(inner))
            else:
                step.append(((*path, key), inner))
        found = step
    return found


def portable_issues(request: dict, loc: Loc) -> list[dict]:
    """A not_portable issue for every field the list does not keep and every picture field that is not an upload ref."""
    keep = set(rules()["keep"])
    found = [issue((*loc, key), "A recipe does not keep this setting", "not_portable", key) for key in request if key not in keep]
    for field in rules()["refs"]:
        for path, value in ref_values(request, field):
            if value in (None, "") or (isinstance(value, str) and HASH_REF_RE.fullmatch(value)):
                continue
            found.append(issue((*loc, *path), "A picture in a recipe is an upload ref", "not_portable", value if isinstance(value, str) and len(value) <= 80 else type(value).__name__))
    return found


def settings_issues(settings: dict, loc: Loc) -> list[dict]:
    """A not_portable issue for every snapshot key the list leaves out."""
    return [issue((*loc, key), "A recipe does not keep this setting", "not_portable", key) for key in rules()["settingsDrop"] if key in settings]
