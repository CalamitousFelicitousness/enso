"""An entry body as the store keeps it, its kind and recipe part checked by the recipe rules."""

from enso_api.documents import issue
from enso_api.media.entries import EntryIn
from enso_api.media.models import EntryBodyV2
from enso_api.recipes.recipe import RecipeCheck, check_recipe, head_of


def kind_issues(body: EntryBodyV2) -> list[dict]:
    """A recipe carries a request and may come without inputs; the other kinds have inputs and no request."""
    if body.kind == "recipe":
        return [issue(("body", "recipe"), "A recipe needs its request", "recipe_kind", None)] if body.recipe is None else []
    found = []
    if body.recipe is not None:
        found.append(issue(("body", "recipe"), "Only a recipe carries a request", "recipe_kind", body.kind))
    if body.inputs is None:
        found.append(issue(("body", "inputs"), "Only a recipe comes without inputs", "recipe_kind", body.kind))
    return found


def build_entry(body: EntryBodyV2, entry_id: str, recipe: dict | None = None, origin: str | None = None) -> tuple[EntryIn | None, list[dict]]:
    """The entry a body describes, else None with the issues the rules raise.

    `recipe` is the part as it is written, which the caller may have resolved further; the body's own otherwise.
    """
    found = kind_issues(body)
    if recipe is None and body.recipe is not None:
        recipe = body.recipe.model_dump()
    check = check_recipe(recipe) if recipe is not None else RecipeCheck(frozenset())
    found.extend(check.issues)
    if found:
        return None, found
    summary = body.summary
    entry = EntryIn(
        id=entry_id,
        kind=body.kind,
        name=body.name,
        saved_at=getattr(body, "saved_at", 0),
        used_at=getattr(body, "used_at", 0),
        pinned=getattr(body, "pinned", False),
        trashed_at=getattr(body, "trashed_at", None),
        frames=summary.frames,
        pictures=summary.pictures,
        role=summary.role,
        control=summary.control,
        width=summary.width,
        height=summary.height,
        inputs_schema=summary.inputs_schema,
        inputs=body.inputs,
        maps=body.maps,
        hashes=body.hashes,
        unavailable=body.unavailable,
        thumbs=[thumb.model_dump() for thumb in body.thumbs],
        recipe=recipe,
        recipe_head=head_of(recipe) if recipe is not None else None,
        recipe_names=check.names,
        recipe_locations=check.locations,
        origin=origin,
    )
    return entry, []
