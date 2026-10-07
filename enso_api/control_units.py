"""Control units and IP-Adapter entries as the request sends them, checked before sdnext builds them."""

from PIL import Image

from enso_api.rejections import RequestRejected


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


def validate(params: dict) -> None:
    """Reject units of more than one type; control_run runs the first unit's type and skips the rest silently."""
    types = unit_types(params.get("control") or [])
    if len(types) > 1:
        raise ControlUnitsError(f"control units must share one type, got {', '.join(types)}")


def masks_per_adapter(masks: list[list[Image.Image] | None], images: list[list[Image.Image]]) -> list[list[Image.Image]]:
    """One mask list per adapter; sdnext drops every adapter when only some have masks, so a missing one is all white."""
    if not any(masks):
        return []
    size = next(given[0].size for given in masks if given)
    return [given or [Image.new("L", size, 255)] * len(adapter_images) for given, adapter_images in zip(masks, images, strict=True)]
