"""Version counters per topic: a change bumps its topic, and the global socket pushes each topic that moved."""

import threading
from typing import Any, NamedTuple


class Version(NamedTuple):
    n: int
    data: dict[str, Any]


lock = threading.Lock()
versions: dict[str, Version] = {}


def bump(topic: str, **data: Any) -> int:
    with lock:
        n = versions[topic].n + 1 if topic in versions else 1
        versions[topic] = Version(n, data)
        return n


def current() -> dict[str, Version]:
    with lock:
        return dict(versions)
