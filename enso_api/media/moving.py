"""A Gallery move: files with their sidecars into another folder, never over a file of the same name.

Each item's outputs rows are journalled in jobs.db before its file moves and follow what moved in one write after, so
a crash between the two is settled at start from where the files are (`JobStore.settle_moves`). Over names and stats
only, with no sdnext import, so pytest runs it alone.
"""

from __future__ import annotations

import contextlib
import hashlib
import logging
import os
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from enso_api.media.companions import TAKEN, Item, is_media, reason_of
from enso_api.media.deleted import twins
from enso_api.media.placement import folder_lock, place

if TYPE_CHECKING:
    from collections.abc import Sequence

    from enso_api.job_store import JobStore

log = logging.getLogger("sd")

ALREADY_HERE = "Already in this folder"


@dataclass
class Moved:
    moved: list[str] = field(default_factory=list)  # each picture or video that moved, as the request spelled it
    errors: list[dict] = field(default_factory=list)


def part_of(path: str) -> str:
    """The part a copy across disks writes beside `path` before taking its name, one per destination path."""
    digest = hashlib.sha256(os.fsencode(os.path.realpath(path))).hexdigest()[:16]
    return os.path.join(os.path.dirname(path), f".enso-{digest}.part")


def arrived(src: str, dst: str) -> bool:
    """Whether a journalled file is at its new path, finishing a move whose last step did not run; the part a copy
    across disks left is removed either way."""
    with contextlib.suppress(FileNotFoundError):
        os.unlink(part_of(dst))
    if not os.path.lexists(dst):
        return False
    if os.path.lexists(src):
        if not twins(src, dst):
            return False
        os.unlink(src)
    return True


def move(items: Sequence[Item], destination: str, store: JobStore | None) -> Moved:
    """Move each item into `destination`, a resolved folder, its file first, then its sidecars."""
    result = Moved()
    mtimes: dict[str, float] = {}
    for item in items:
        for name in (item.name, *item.companions):
            with contextlib.suppress(OSError):
                mtimes[os.path.join(item.folder, name)] = os.stat(os.path.join(item.folder, name)).st_mtime * 1000
    rows = store.output_ids_at(mtimes) if store is not None else {}
    for item in items:
        if item.folder == destination:
            result.errors.extend({"file": path, "error": ALREADY_HERE} for path in item.asked())
            continue
        planned = [(output_id, os.path.join(item.folder, name), os.path.join(destination, name)) for name in (item.name, *item.companions) for output_id in rows.get(os.path.join(item.folder, name), ())]
        placed = move_item(item, destination, planned, store, result)
        if placed is None:
            continue
        if store is not None and planned:
            store.finish_moves([(output_id, dst) for output_id, _, dst in planned if os.path.basename(dst) in placed], planned)
        result.moved.extend(item.spelled(name) for name in placed if is_media(name))
    return result


def move_item(item: Item, destination: str, planned: list[tuple[str, str, str]], store: JobStore | None, result: Moved) -> list[str] | None:
    """Under the folder's lock: the journal, then the file and its sidecars placed; the names that went, none when the
    file stayed, None when a name was taken and nothing was journalled."""
    with folder_lock(destination):
        taken = next((name for name in (item.name, *item.companions) if os.path.lexists(os.path.join(destination, name))), None)
        if taken is not None:
            reason = TAKEN if taken == item.name else f"A file named {taken} is already there"
            result.errors.extend({"file": path, "error": reason} for path in item.asked())
            return None
        if store is not None and planned:
            store.plan_moves(planned)
        placed: list[str] = []
        for name in (item.name, *item.companions):
            target = os.path.join(destination, name)
            part = part_of(target)
            try:
                # A part of this name is what a crash left, since the lock keeps any other move from writing it
                with contextlib.suppress(FileNotFoundError):
                    os.unlink(part)
                place(os.path.join(item.folder, name), target, part)
            except OSError as e:
                if name == item.name:
                    reason = TAKEN if isinstance(e, FileExistsError) else reason_of(e)
                    result.errors.extend({"file": path, "error": reason} for path in item.asked())
                    return []
                log.warning(f'Gallery move: "{name}" beside "{item.name}" kept: {e}')
                if name in item.requested:
                    result.errors.append({"file": item.requested[name], "error": reason_of(e)})
                continue
            placed.append(name)
        return placed
