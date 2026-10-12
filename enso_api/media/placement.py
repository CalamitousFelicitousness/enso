"""Putting a file at a new name without ever replacing one, on one disk or across two."""

import contextlib
import errno
import os
import shutil
import sys
import threading
import uuid
from collections.abc import Iterator

# A filesystem that cannot link across them, or at all
NO_LINK = {errno.EXDEV, errno.EPERM, errno.EOPNOTSUPP, errno.ENOTSUP}
COPY_CHUNK = 4 << 20

locks: dict[str, threading.Lock] = {}
locks_guard = threading.Lock()


class ChangedWhileMoving(OSError):
    def __init__(self, path: str):
        super().__init__(errno.EAGAIN, "Changed while moving", path)


@contextlib.contextmanager
def folder_lock(path: str) -> Iterator[None]:
    """This process's lock for one destination folder, held while a name there is chosen and a file placed under it."""
    key = os.path.realpath(path)
    with locks_guard:
        lock = locks.setdefault(key, threading.Lock())
    with lock:
        yield


def fsync_folder(path: str) -> None:
    if sys.platform == "win32":
        return
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def place(src: str, dst: str) -> None:
    """Move `src` to `dst`; FileExistsError when `dst` exists. One disk: a link, then the source unlinked. Across disks:
    a copy into a part beside `dst`, flushed, linked to its name and the folder flushed before the source goes."""
    try:
        os.link(src, dst)
    except OSError as e:
        if e.errno not in NO_LINK:
            raise
        copy_across(src, dst)
        return
    unlink_source(src, dst)


def unlink_source(src: str, dst: str) -> None:
    """The last step of a move; when the source cannot go, the new name goes instead, so the file is never at both."""
    try:
        os.unlink(src)
    except OSError:
        with contextlib.suppress(OSError):
            os.unlink(dst)
        raise


def copy_across(src: str, dst: str) -> None:
    folder = os.path.dirname(dst)
    size = os.stat(src).st_size
    part = os.path.join(folder, f".enso-{uuid.uuid4().hex[:16]}.part")
    fd = os.open(part, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    try:
        with os.fdopen(fd, "wb") as out:
            with open(src, "rb") as source:
                shutil.copyfileobj(source, out, COPY_CHUNK)
            out.flush()
            shutil.copystat(src, part)
            os.fsync(out.fileno())
        if os.stat(src).st_size != size or os.stat(part).st_size != size:
            raise ChangedWhileMoving(src)
        try:
            os.link(part, dst)
        except OSError as e:
            if e.errno not in NO_LINK:
                raise
            # No links at all here: an exclusive create holds the name while the part is renamed over it
            os.close(os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644))
            os.replace(part, dst)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(part)
    fsync_folder(folder)
    unlink_source(src, dst)
