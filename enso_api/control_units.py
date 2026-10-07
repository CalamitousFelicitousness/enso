"""Control units as the request sends them, checked before sdnext builds them."""

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
