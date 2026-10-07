"""Control units and IP-Adapter entries as the request sends them, checked before sdnext builds them."""

from PIL import Image

from enso_api.rejections import RequestRejected
from enso_api.sdnext_features import CONTROL_SEPARATE_INIT_COMMITS


class ControlUnitsError(RequestRejected):
    """Control units sdnext would not run as sent."""


def unit_types(control: list) -> list[str]:
    """Distinct unit types in request order."""
    types = []
    for unit in control:
        if not isinstance(unit, dict):
            continue
        kind = unit.get("unit_type", "controlnet")
        if kind not in types:
            types.append(kind)
    return types


def own_pictures(control: list) -> bool:
    """Whether any unit brings its own picture."""
    return any(isinstance(unit, dict) and (unit.get("override") or unit.get("image")) for unit in control)


def validate(params: dict, control_separate_init: bool) -> None:
    """Reject what control_run would run as something else: several unit types, or a unit's own picture beside a separate init image on an sdnext that hands the ControlNet the init instead."""
    control = params.get("control") or []
    types = unit_types(control)
    if len(types) > 1:
        raise ControlUnitsError(f"control units must share one type, got {', '.join(types)}")
    if params.get("input_type") == 2 and params.get("inits") and own_pictures(control) and not control_separate_init:
        raise ControlUnitsError(f"a control unit's own picture beside an init image needs an sdnext carrying commit {CONTROL_SEPARATE_INIT_COMMITS[0]} (dev, 2026-10-05)")


def masks_per_adapter(masks: list[list[Image.Image] | None], images: list[list[Image.Image]]) -> list[list[Image.Image]]:
    """One mask list per adapter; sdnext drops every adapter when only some have masks, so a missing one is all white."""
    if not any(masks):
        return []
    size = next(given[0].size for given in masks if given)
    return [given or [Image.new("L", size, 255)] * len(adapter_images) for given, adapter_images in zip(masks, images, strict=True)]
