"""The global socket's topics.

A state topic carries its last payload, which is the truth (media, settings); a change topic carries
the ids changed since a socket last looked (library, trash, records), from a log of its last bumps.
"""

import threading
from collections import deque
from collections.abc import Iterable
from typing import Any, NamedTuple

CHANGE_LOG = 256


class Version(NamedTuple):
    n: int
    data: dict[str, Any]


class Changes(NamedTuple):
    n: int
    ids: frozenset[str] | None  # None once the reader is further behind than the log


lock = threading.Lock()
versions: dict[str, Version] = {}
logs: dict[str, deque[tuple[int, frozenset[str]]]] = {}


def next_n(topic: str) -> int:
    return versions[topic].n + 1 if topic in versions else 1


def bump(topic: str, **data: Any) -> int:
    """A state topic moved; `data` replaces its payload."""
    with lock:
        n = next_n(topic)
        versions[topic] = Version(n, data)
        return n


def changed(topic: str, ids: Iterable[str]) -> int:
    """A change topic moved; the ids join its log."""
    with lock:
        n = next_n(topic)
        versions[topic] = Version(n, {})
        logs.setdefault(topic, deque(maxlen=CHANGE_LOG)).append((n, frozenset(ids)))
        return n


def current() -> dict[str, Version]:
    with lock:
        return dict(versions)


def since(topic: str, n: int) -> Changes:
    """The ids a change topic gained after version `n`."""
    with lock:
        return changes_after(topic, n)


def changes_after(topic: str, n: int) -> Changes:
    version = versions.get(topic)
    if version is None:
        return Changes(n, frozenset())
    entries = logs.get(topic, ())
    if entries and entries[0][0] > n + 1:
        return Changes(version.n, None)
    return Changes(version.n, frozenset().union(*(ids for m, ids in entries if m > n)))


def pending(sent: dict[str, int]) -> list[dict[str, Any]]:
    """The events a socket owes, one per topic that moved since `sent`, which is brought up to date."""
    owed = []
    with lock:
        for topic, version in versions.items():
            last = sent.get(topic, 0)
            if last == version.n:
                continue
            sent[topic] = version.n
            if topic in logs:
                ids = changes_after(topic, last).ids
                owed.append({"type": topic, "data": {"ids": None if ids is None else sorted(ids)}})
            else:
                owed.append({"type": topic, "data": version.data})
    return owed
