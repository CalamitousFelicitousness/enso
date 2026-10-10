"""Where the media store keeps its files, and which folder it uses."""

import os
import re
import sys
import tempfile
import uuid
from collections.abc import Callable
from typing import NamedTuple

from enso_api.media.sniff import EXTENSIONS

HASH_RE = re.compile(r"[0-9a-f]{64}")
LEGACY_RE = re.compile(r"[0-9a-f]{16}")
OPTION_LABEL = "Media store folder"


class Resolved(NamedTuple):
    root: str | None
    reason: str | None  # why there is no root
    previous: str | None  # the root an earlier boot used, when it differs


def default_root(data_dir: str) -> str:
    return os.path.join(data_dir, "data", "enso", "media")


def resolve_root(configured: str, data_dir: str, marker: str | None, probe: Callable[[str], str | None]) -> Resolved:
    """The root from the option: empty is the default, which the caller creates; a relative value is under the data folder.

    A configured folder that is missing or not writable gives the reason and no root; it is never created here.
    """
    configured = configured.strip()
    if configured:
        root = os.path.abspath(os.path.join(data_dir, os.path.expanduser(configured)))
        failure = probe(root)
        if failure:
            return Resolved(None, f"{root} set by '{OPTION_LABEL}' {failure}", None)
    else:
        root = os.path.abspath(default_root(data_dir))
    previous = marker.strip() if marker else None
    return Resolved(root, None, previous if previous and previous != root else None)


def probe_folder(path: str) -> str | None:
    """None when the folder exists and takes a file, else what is wrong."""
    if not os.path.isdir(path):
        return "does not exist"
    try:
        fd, name = tempfile.mkstemp(prefix=".enso-probe-", dir=path)
        os.close(fd)
        os.remove(name)
    except OSError as e:
        return f"is not writable ({e.strerror or e})"
    return None


class Layout:
    def __init__(self, root: str):
        self.root = root
        self.real_root = os.path.realpath(root)
        self.db = os.path.join(root, "media.db")
        self.blobs = os.path.join(root, "blobs")
        self.tmp = os.path.join(root, "tmp")
        self.snapshots = os.path.join(root, "snapshots")
        self.corrupt = os.path.join(root, "corrupt")
        self.lock_fd: int | None = None

    def make(self) -> None:
        for path in (self.root, self.blobs, self.tmp, self.snapshots, self.corrupt):
            os.makedirs(path, exist_ok=True)

    @staticmethod
    def fan(digest: str) -> str:
        return digest[:2]

    def fan_dir(self, digest: str) -> str:
        return os.path.join(self.blobs, self.fan(digest))

    def blob_path(self, digest: str, ext: str) -> str:
        """The file of a blob; refuses anything but a full lowercase SHA-256 and a known extension, so no ref becomes a path."""
        if not isinstance(digest, str) or not HASH_RE.fullmatch(digest):
            raise ValueError(f"not a blob hash: {digest!r}")
        if ext not in EXTENSIONS:
            raise ValueError(f"not a blob extension: {ext!r}")
        return os.path.join(self.fan_dir(digest), f"{digest}.{ext}")

    def new_part(self) -> str:
        return os.path.join(self.tmp, f"{uuid.uuid4().hex}.part")

    def contains(self, path: str) -> bool:
        """Whether the path is the root or inside it, by name: no filesystem access, for walks that visit every folder."""
        absolute = os.path.abspath(path)
        return any(absolute == root or absolute.startswith(root + os.sep) for root in (os.path.abspath(self.root), self.real_root))

    def under_root(self, path: str) -> bool:
        """Whether the path, symlinks resolved, is the root or inside it."""
        return self.contains(os.path.realpath(path))

    def lock(self) -> bool:
        """Hold the root's lock file for the life of the process; False when another process holds it."""
        fd = os.open(os.path.join(self.root, ".lock"), os.O_RDWR | os.O_CREAT, 0o644)
        try:
            if sys.platform == "win32":
                import msvcrt

                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            os.close(fd)
            return False
        self.lock_fd = fd
        return True
