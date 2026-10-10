"""The store's policy settings: validated when written, clamped when read."""

from collections.abc import Mapping
from dataclasses import dataclass, fields
from typing import NamedTuple


class Bound(NamedTuple):
    low: int
    high: int
    default: int


BOUNDS = {
    "trash_days": Bound(1, 30, 7),
    "library_cap": Bound(10, 1000, 100),
    "record_cap": Bound(50, 2000, 200),
    "reserve_bytes": Bound(256 << 20, 1 << 40, 2 << 30),
}


@dataclass(frozen=True)
class Settings:
    trash_days: int = BOUNDS["trash_days"].default
    library_cap: int = BOUNDS["library_cap"].default
    record_cap: int = BOUNDS["record_cap"].default
    reserve_bytes: int = BOUNDS["reserve_bytes"].default

    def as_dict(self) -> dict[str, int]:
        return {field.name: getattr(self, field.name) for field in fields(self)}


def parse(value: str | None) -> int | None:
    try:
        return int(value) if value is not None else None
    except ValueError:
        return None


def clamp(raw: Mapping[str, str]) -> Settings:
    """Settings from stored text: a missing or unreadable value is the default, one out of bounds the nearest bound."""
    values = {}
    for key, bound in BOUNDS.items():
        value = parse(raw.get(key))
        values[key] = bound.default if value is None else min(max(value, bound.low), bound.high)
    return Settings(**values)


def problems(raw: Mapping[str, str]) -> list[str]:
    """The stored settings clamp() had to change, worded for the log."""
    found = []
    for key, bound in BOUNDS.items():
        if key not in raw:
            continue
        value = parse(raw[key])
        if value is None:
            found.append(f"{key}={raw[key]!r} is not a number, using {bound.default}")
        elif not bound.low <= value <= bound.high:
            found.append(f"{key}={value} is outside {bound.low} to {bound.high}")
    return found
