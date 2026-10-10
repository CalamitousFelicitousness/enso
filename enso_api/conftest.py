import os
import shutil
import tempfile

import pytest


class Clock:
    """A settable clock in epoch milliseconds."""

    def __init__(self, now: int = 1_760_000_000_000):
        self.now = now

    def __call__(self) -> int:
        return self.now

    def advance(self, ms: int) -> None:
        self.now += ms


@pytest.fixture
def root(tmp_path):
    """A fresh folder, in memory where /dev/shm exists."""
    if not os.path.isdir("/dev/shm"):
        yield str(tmp_path)
        return
    path = tempfile.mkdtemp(prefix="enso-test-", dir="/dev/shm")
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


@pytest.fixture
def clock():
    return Clock()
