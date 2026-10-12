"""Gallery files in the trash: a folder per file under the store's trash/, holding the file, the sidecars that went with
it and a manifest, and a row in media.db whose state precedes every move.

A row is `moving` before a file leaves its folder and `restoring`, with the path it goes to, before it comes back, so a
crash at any point is settled at start from where the file is. Expiry, Delete now and Empty take `trashed` rows alone,
and a folder on its way out is renamed into .gone/ first, so a crash never brings a deleted file back.
"""

from __future__ import annotations

import contextlib
import errno
import json
import logging
import os
import shutil
import threading
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from enso_api.media.companions import NOT_FOUND, Item, Protected, free_stem, gather, is_media, is_video, protected_reason, reason_of, rename_companion
from enso_api.media.layout import TRASH_ID_RE, Layout
from enso_api.media.placement import folder_lock, place
from enso_api.media.settings import DAY_MS, Settings
from enso_api.media.store import chunks, marks

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence

    from enso_api.sqlite import Database

log = logging.getLogger("sd")

# A browser shows an output from its cache this long, so a deleted output is remembered as deleted for as long
GONE_KEPT_MS = 3600 * 1000
BATCH = 50
MANIFEST = "manifest.json"
# When a file's retention period started: its trash, its loss, or a restarted collection clock
CLOCK_SQL = "MAX(COALESCE(clock_at, 0), COALESCE(lost_at, trashed_at))"

DISK_CANNOT_TAKE = "The disk the trash is on cannot take it"
FOLDER_CANNOT_TAKE = "The folder's disk cannot take it"
FOLDER_LEFT_GALLERY = "Its folder is no longer a Gallery folder"
BEING_RESTORED = "Being restored"
NOT_IN_TRASH = "No longer in the trash"


@dataclass(frozen=True)
class Lookups:
    """What the trash reads beyond media.db, bound late: the outputs table opens after the store."""

    output_ids_at: Callable[[Mapping[str, float]], dict[str, list[str]]]
    repath_outputs: Callable[[Iterable[tuple[str, str]]], int]
    output_path: Callable[[str], str | None]
    gallery_allows: Callable[[str], bool]
    protected: Callable[[], Protected]
    free_space: Callable[[str], int]


@dataclass(frozen=True)
class Row:
    id: str
    state: str
    name: str
    folder: str
    companions: tuple[str, ...]
    kind: str
    size: int
    bytes: int
    mtime: int
    trashed_at: int
    trashed_by: str | None
    clock_at: int | None
    restore_to: str | None
    lost_at: int | None

    @classmethod
    def of(cls, row) -> Row:
        return cls(
            row["id"],
            row["state"],
            row["name"],
            row["folder"],
            tuple(json.loads(row["companions"])),
            row["kind"],
            row["size"],
            row["bytes"],
            row["mtime"],
            row["trashed_at"],
            row["trashed_by"],
            row["clock_at"],
            row["restore_to"],
            row["lost_at"],
        )

    @property
    def clock(self) -> int:
        return max(self.clock_at or 0, self.lost_at if self.lost_at is not None else self.trashed_at)

    def names(self) -> list[str]:
        return [self.name, *self.companions]


@dataclass
class Planned:
    id: str
    item: Item
    stats: dict[str, tuple[int, int]]  # name: size, mtime in ms


@dataclass
class Trashed:
    items: list[dict] = field(default_factory=list)
    moved: list[dict] = field(default_factory=list)  # each Gallery file that left a folder: the request's spelling, its path in the trash
    errors: list[dict] = field(default_factory=list)
    folders: set[str] = field(default_factory=set)


@dataclass
class Restored:
    items: list[dict] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)
    folders: set[str] = field(default_factory=set)


@dataclass
class Freed:
    ids: list[str] = field(default_factory=list)
    bytes: int = 0


@dataclass
class Listed:
    items: list[dict]
    total: int
    bytes: int
    as_of: int


@dataclass
class OutputsMap:
    trashed: dict[str, tuple[str, int]]  # output id: the item holding it, when it expires
    gone: dict[str, int]  # output id: when its file was deleted from the trash


@dataclass
class Reconciled:
    trashed: int = 0
    dropped: int = 0
    restored: int = 0
    returned: int = 0
    lost: int = 0
    found: int = 0
    adopted: int = 0
    strays: int = 0


def new_id() -> str:
    return uuid.uuid4().hex[:16]


def mtime_ms(st: os.stat_result) -> int:
    return st.st_mtime_ns // 1_000_000


def kind_of(name: str) -> str:
    return "video" if is_video(name) else "image"


def log_lost(count: int) -> None:
    if count:
        log.warning(f"Gallery trash: lost={count}, their files are gone from the trash")


def size_text(count: int) -> str:
    for unit, scale in (("GB", 1e9), ("MB", 1e6), ("KB", 1e3)):
        if count >= scale:
            return f"{count / scale:.1f} {unit}"
    return f"{count} bytes"


def file_error(path: str, reason: str) -> dict:
    return {"file": path, "error": reason}


def id_error(item_id: str, name: str, reason: str) -> dict:
    return {"id": item_id, "name": name, "error": reason}


def matches(path: str, size: int, mtime: int) -> bool:
    try:
        st = os.lstat(path)
    except OSError:
        return False
    return st.st_size == size and mtime_ms(st) == mtime


def on_same_disk(a: str, b: str) -> bool:
    return os.stat(a).st_dev == os.stat(b).st_dev


def twins(a: str, b: str) -> bool:
    """One file under two names, or a copy that kept size and mtime: a move whose last step did not run."""
    try:
        sa, sb = os.lstat(a), os.lstat(b)
    except OSError:
        return False
    return (sa.st_dev, sa.st_ino) == (sb.st_dev, sb.st_ino) or (sa.st_size, sa.st_mtime_ns) == (sb.st_size, sb.st_mtime_ns)


def write_manifest(folder: str, row: Row, outputs: Iterable[tuple[str, str]]) -> None:
    """What the row holds, beside the file, so a folder whose row was lost can be taken back in."""
    body = {
        "id": row.id,
        "name": row.name,
        "folder": row.folder,
        "companions": list(row.companions),
        "kind": row.kind,
        "size": row.size,
        "bytes": row.bytes,
        "mtime": row.mtime,
        "trashed_at": row.trashed_at,
        "trashed_by": row.trashed_by,
        "outputs": [[output_id, name] for output_id, name in outputs],
    }
    path = os.path.join(folder, MANIFEST)
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(body, f)
    os.replace(path + ".tmp", path)


def read_manifest(folder: str) -> dict | None:
    try:
        with open(os.path.join(folder, MANIFEST), encoding="utf-8") as f:
            body = json.load(f)
    except (OSError, ValueError):
        return None
    shapes = {"id": str, "name": str, "folder": str, "companions": list, "kind": str, "size": int, "bytes": int, "mtime": int, "trashed_at": int, "outputs": list}
    if not isinstance(body, dict) or any(not isinstance(body.get(key), kind) for key, kind in shapes.items()):
        return None
    names = [body["name"], *body["companions"]]
    if any(not isinstance(name, str) or os.sep in name or name in ("", ".", "..", MANIFEST) for name in names):
        return None
    if any(not (isinstance(pair, list) and len(pair) == 2 and all(isinstance(part, str) for part in pair)) for pair in body["outputs"]):
        return None
    return body


class DeletedFiles:
    def __init__(self, db: Database, layout: Layout, lookups: Lookups, settings: Callable[[], Settings], now: Callable[[], int]):
        self.db = db
        self.layout = layout
        self.lookups = lookups
        self.settings = settings
        self.now = now
        self.busy: set[str] = set()
        self.busy_lock = threading.Lock()
        self.strays = 0

    @contextlib.contextmanager
    def holding(self, ids: Iterable[str]) -> Iterator[None]:
        """Mark ids in flight for a call, so a pass leaves their rows and folders alone."""
        held = set(ids)
        with self.busy_lock:
            self.busy |= held
        try:
            yield
        finally:
            with self.busy_lock:
                self.busy -= held

    def in_flight(self) -> set[str]:
        with self.busy_lock:
            return set(self.busy)

    def trash_ms(self) -> int:
        return self.settings().trash_ms

    def rows(self, ids: Iterable[str]) -> dict[str, Row]:
        found: dict[str, Row] = {}
        with self.db.read() as conn:
            for part in chunks(sorted(set(ids))):
                for row in conn.execute(f"SELECT * FROM trashed_files WHERE id IN ({marks(len(part))})", part):
                    found[row["id"]] = Row.of(row)
        return found

    def outputs_of(self, item_id: str) -> list[tuple[str, str]]:
        with self.db.read() as conn:
            return [(row[0], row[1]) for row in conn.execute("SELECT output_id, name FROM trashed_outputs WHERE item_id = ? ORDER BY output_id", (item_id,))]

    def item_of(self, row: Row, outputs: list[str], trash_ms: int) -> dict:
        return {
            "id": row.id,
            "name": row.name,
            "folder": row.folder,
            "path": os.path.join(self.layout.item_dir(row.id), row.name),
            "kind": row.kind,
            "size": row.size,
            "bytes": row.bytes,
            "mtime": row.mtime,
            "trashed_at": row.trashed_at,
            "trashed_by": row.trashed_by,
            "expires_at": row.clock + trash_ms,
            "output_ids": outputs,
            "lost": row.lost_at is not None,
        }

    def items_of(self, ids: Iterable[str]) -> list[dict]:
        rows = self.rows(ids)
        trash_ms = self.trash_ms()
        return [self.item_of(row, [output_id for output_id, _ in self.outputs_of(row.id)], trash_ms) for row in rows.values()]

    # trash

    def trash(self, paths: Sequence[str], user: str | None) -> Trashed:
        """Move Gallery files with their sidecars into the trash, a folder each; the outputs rows of what moved follow it."""
        result = Trashed()
        now = self.now()
        # File times are the filesystem's, so whether a file is still being saved is judged by the wall clock
        items, result.errors = gather(paths, self.lookups.gallery_allows, self.lookups.protected(), time.time())
        planned: list[Planned] = []
        for item in items:
            stats: dict[str, tuple[int, int]] = {}
            for name in (item.name, *item.companions):
                with contextlib.suppress(OSError):
                    st = os.lstat(os.path.join(item.folder, name))
                    stats[name] = (st.st_size, mtime_ms(st))
            if item.name not in stats:
                result.errors.extend(file_error(path, NOT_FOUND) for path in item.asked())
                continue
            planned.append(Planned(new_id(), item, stats))
        if not planned:
            return result
        found = self.lookups.output_ids_at({os.path.join(p.item.folder, name): mtime for p in planned for name, (_, mtime) in p.stats.items()})
        with self.holding(p.id for p in planned):
            with self.db.write(durable=True) as w:
                for p in planned:
                    size, mtime = p.stats[p.item.name]
                    w.conn.execute(
                        "INSERT INTO trashed_files (id, state, name, folder, companions, kind, size, bytes, mtime, trashed_at, trashed_by) VALUES (?, 'moving', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (p.id, p.item.name, p.item.folder, json.dumps(list(p.item.companions)), kind_of(p.item.name), size, sum(s for s, _ in p.stats.values()), mtime, now, user),
                    )
                    # A row another item already holds stays with it
                    for name in p.stats:
                        w.conn.executemany(
                            "INSERT OR IGNORE INTO trashed_outputs (output_id, item_id, name) VALUES (?, ?, ?)",
                            [(output_id, p.id, name) for output_id in found.get(os.path.join(p.item.folder, name), ())],
                        )
            moved = {p.id: self.move_in(p, result) for p in planned}
            self.settle_trashed(planned, moved, now, user)
        done = [p for p in planned if moved[p.id]]
        result.items = self.items_of(p.id for p in done)
        for p in done:
            folder = self.layout.item_dir(p.id)
            result.folders.add(p.item.folder)
            result.moved.extend({"file": p.item.spelled(name), "path": os.path.join(folder, name)} for name in moved[p.id] if is_media(name))
        return result

    def move_in(self, p: Planned, result: Trashed) -> list[str]:
        """Place a file, then its sidecars, in its trash folder; the names that went, none when the file stayed."""
        folder = self.layout.item_dir(p.id)
        part = os.path.join(folder, f".enso-{p.id}.part")
        try:
            os.makedirs(folder)
            if not on_same_disk(p.item.folder, folder):
                needed = sum(size for size, _ in p.stats.values())
                room = self.lookups.free_space(self.layout.root) - self.settings().reserve_bytes
                if needed > room:
                    raise OSError(errno.ENOSPC, f"{DISK_CANNOT_TAKE} ({size_text(needed)} needed, {size_text(max(room, 0))} free)")
            place(p.item.path, os.path.join(folder, p.item.name), part)
        except OSError as e:
            shutil.rmtree(folder, ignore_errors=True)
            result.errors.extend(file_error(path, reason_of(e)) for path in p.item.asked())
            return []
        moved = [p.item.name]
        for name in p.item.companions:
            try:
                place(os.path.join(p.item.folder, name), os.path.join(folder, name), part)
            except OSError as e:
                log.warning(f'Gallery trash: "{name}" beside "{p.item.name}" stays in {p.item.folder}: {e}')
                if name in p.item.requested:
                    result.errors.append(file_error(p.item.requested[name], reason_of(e)))
                continue
            moved.append(name)
        return moved

    def settle_trashed(self, planned: list[Planned], moved: dict[str, list[str]], now: int, user: str | None) -> None:
        """After the moves: the manifests, the outputs rows repathed into the trash, then the rows trashed or dropped."""
        pairs: list[tuple[str, str]] = []
        for p in planned:
            names = moved[p.id]
            if not names:
                continue
            folder = self.layout.item_dir(p.id)
            outputs = [(output_id, name) for output_id, name in self.outputs_of(p.id) if name in names]
            pairs.extend((output_id, os.path.join(folder, name)) for output_id, name in outputs)
            size, mtime = p.stats[p.item.name]
            row = Row(p.id, "trashed", p.item.name, p.item.folder, tuple(names[1:]), kind_of(p.item.name), size, sum(p.stats[name][0] for name in names), mtime, now, user, None, None, None)
            try:
                write_manifest(folder, row, outputs)
            except OSError as e:
                log.warning(f"Gallery trash: no manifest for {p.id}: {e}")
        self.lookups.repath_outputs(pairs)
        with self.db.write(durable=True) as w:
            for p in planned:
                names = moved[p.id]
                if not names:
                    w.conn.execute("DELETE FROM trashed_files WHERE id = ?", (p.id,))
                    continue
                w.conn.execute(
                    "UPDATE trashed_files SET state = 'trashed', companions = ?, bytes = ? WHERE id = ?",
                    (json.dumps(names[1:]), sum(p.stats[name][0] for name in names), p.id),
                )
                w.conn.execute(f"DELETE FROM trashed_outputs WHERE item_id = ? AND name NOT IN ({marks(len(names))})", [p.id, *names])

    # restore

    def restore(self, ids: Sequence[str], folder: str | None = None) -> Restored:
        """Put files back, each in its own folder or in `folder`, under a stem free for the file and every sidecar."""
        result = Restored()
        target = os.path.realpath(folder) if folder else None
        for batch in chunks(list(dict.fromkeys(ids)), BATCH):
            with self.holding(batch):
                rows = self.rows(batch)
                for item_id in batch:
                    row = rows.get(item_id)
                    if row is None or row.state != "trashed":
                        reason = BEING_RESTORED if row is not None and row.state == "restoring" else NOT_IN_TRASH
                        result.errors.append(id_error(item_id, row.name if row is not None else "", reason))
                        continue
                    self.restore_one(row, target or row.folder, result)
        return result

    def restore_one(self, row: Row, target: str, result: Restored) -> None:
        source = self.layout.item_dir(row.id)
        if row.lost_at is not None or not os.path.isfile(os.path.join(source, row.name)):
            result.errors.append(id_error(row.id, row.name, NOT_FOUND))
            return
        if not self.lookups.gallery_allows(target):
            result.errors.append(id_error(row.id, row.name, FOLDER_LEFT_GALLERY))
            return
        kept = protected_reason(os.path.realpath(target), self.lookups.protected())
        if kept is not None:
            result.errors.append(id_error(row.id, row.name, kept))
            return
        try:
            os.makedirs(target, exist_ok=True)
            if not on_same_disk(target, source) and row.bytes > self.lookups.free_space(target):
                raise OSError(errno.ENOSPC, f"{FOLDER_CANNOT_TAKE} ({size_text(row.bytes)} needed)")
        except OSError as e:
            result.errors.append(id_error(row.id, row.name, reason_of(e)))
            return
        stem, ext = os.path.splitext(row.name)
        part = os.path.join(target, f".enso-{row.id}.part")
        moved: dict[str, str] = {}
        left: list[str] = []
        with folder_lock(target):
            new_stem = free_stem(target, stem, ext, row.companions, os.path.lexists)
            restore_to = os.path.join(target, new_stem + ext)
            # The target is durable before the file moves, so a crash is settled by where the file is, never by its old name
            with self.db.write(durable=True) as w:
                if not w.conn.execute("UPDATE trashed_files SET state = 'restoring', restore_to = ? WHERE id = ? AND state = 'trashed'", (restore_to, row.id)).rowcount:
                    result.errors.append(id_error(row.id, row.name, NOT_IN_TRASH))
                    return
            try:
                place(os.path.join(source, row.name), restore_to, part)
            except OSError as e:
                with self.db.write(durable=True) as w:
                    w.conn.execute("UPDATE trashed_files SET state = 'trashed', restore_to = NULL WHERE id = ?", (row.id,))
                result.errors.append(id_error(row.id, row.name, reason_of(e)))
                return
            moved[row.name] = restore_to
            for companion in row.companions:
                destination = os.path.join(target, rename_companion(companion, stem, new_stem))
                try:
                    place(os.path.join(source, companion), destination, part)
                except OSError as e:
                    log.warning(f'Gallery trash: "{companion}" of "{row.name}" stays in the trash: {e}')
                    left.append(companion)
                    continue
                moved[companion] = destination
        self.finish_restore(row, moved, left)
        result.folders.add(target)
        result.items.append({"id": row.id, "path": restore_to, "name": os.path.basename(restore_to), "renamed": new_stem != stem, "left": left})

    def finish_restore(self, row: Row, moved: Mapping[str, str], left: Sequence[str]) -> None:
        """The outputs rows follow what came back and the row goes; a sidecar that could not leave stays in the folder,
        which loses its manifest and is removed with the strays."""
        self.lookups.repath_outputs([(output_id, moved[name]) for output_id, name in self.outputs_of(row.id) if name in moved])
        folder = self.layout.item_dir(row.id)
        with contextlib.suppress(FileNotFoundError):
            os.remove(os.path.join(folder, MANIFEST))
        with self.db.write(durable=True) as w:
            w.conn.execute("DELETE FROM trashed_files WHERE id = ?", (row.id,))
        if not left:
            shutil.rmtree(folder, ignore_errors=True)

    # delete

    def discard(self, ids: Sequence[str], where: str = "", binds: tuple = ()) -> Freed:
        """Delete files in the trash for good, in batches: under the lock each folder is renamed into .gone/, its row
        deleted and its outputs remembered as gone; the folders are removed after."""
        freed = Freed()
        now = self.now()
        for batch in chunks(list(dict.fromkeys(ids)), BATCH):
            renamed: list[tuple[str, str]] = []
            ids_done: list[str] = []
            size = 0
            try:
                with self.db.write(durable=True) as w:
                    for item_id in batch:
                        row = w.conn.execute(f"SELECT bytes, lost_at FROM trashed_files WHERE id = ? AND state = 'trashed' {where}", (item_id, *binds)).fetchone()
                        if row is None:
                            continue
                        folder, gone = self.layout.item_dir(item_id), self.layout.gone_dir(item_id)
                        if os.path.lexists(folder):
                            shutil.rmtree(gone, ignore_errors=True)
                            os.replace(folder, gone)
                            renamed.append((folder, gone))
                        outputs = [found[0] for found in w.conn.execute("SELECT output_id FROM trashed_outputs WHERE item_id = ?", (item_id,))]
                        w.conn.execute("DELETE FROM trashed_files WHERE id = ?", (item_id,))
                        w.conn.executemany(
                            "INSERT INTO gone_outputs (output_id, gone_at) VALUES (?, ?) ON CONFLICT(output_id) DO UPDATE SET gone_at = excluded.gone_at",
                            [(output_id, now) for output_id in outputs],
                        )
                        ids_done.append(item_id)
                        size += 0 if row["lost_at"] is not None else row["bytes"]
            except BaseException:
                for folder, gone in renamed:
                    with contextlib.suppress(OSError):
                        os.replace(gone, folder)
                raise
            for _, gone in renamed:
                shutil.rmtree(gone, ignore_errors=True)
            freed.ids.extend(ids_done)
            freed.bytes += size
        return freed

    def delete(self, ids: Sequence[str]) -> Freed:
        """Delete these files from the trash for good; an id not in the trash is skipped."""
        return self.discard(ids)

    def empty(self, as_of: int) -> Freed:
        """Delete every file in the trash that was there when the list was read at `as_of`."""
        with self.db.read() as conn:
            ids = [row[0] for row in conn.execute("SELECT id FROM trashed_files WHERE state = 'trashed' AND trashed_at <= ?", (as_of,))]
        return self.discard(ids, "AND trashed_at <= ?", (as_of,))

    # reads

    def list(self) -> Listed:
        """The files in the trash, newest first, read at `as_of`."""
        now = self.now()
        trash_ms = self.trash_ms()
        with self.db.read(snapshot=True) as conn:
            rows = [Row.of(row) for row in conn.execute("SELECT * FROM trashed_files WHERE state = 'trashed' ORDER BY trashed_at DESC, id")]
            outputs: dict[str, list[str]] = defaultdict(list)
            for output_id, item_id in conn.execute("SELECT output_id, item_id FROM trashed_outputs ORDER BY output_id"):
                outputs[item_id].append(output_id)
        items = [self.item_of(row, outputs[row.id], trash_ms) for row in rows]
        return Listed(items, len(items), sum(row.bytes for row in rows if row.lost_at is None), now)

    def outputs_map(self) -> OutputsMap:
        """The outputs whose files are in the trash, with when they expire, and those deleted from it within the hour."""
        now = self.now()
        trash_ms = self.trash_ms()
        with self.db.read(snapshot=True) as conn:
            trashed = {output_id: (item_id, clock + trash_ms) for output_id, item_id, clock in conn.execute(f"SELECT o.output_id, f.id, {CLOCK_SQL} FROM trashed_outputs o JOIN trashed_files f ON f.id = o.item_id WHERE f.state = 'trashed'")}
            gone = dict(conn.execute("SELECT output_id, gone_at FROM gone_outputs WHERE gone_at >= ?", (now - GONE_KEPT_MS,)).fetchall())
        return OutputsMap(trashed, gone)

    def holds_path(self, path: str) -> bool:
        """Whether `path` is a file of the trash: exactly <root>/trash/<id>/<name> for a row's file or one of its sidecars."""
        folder, name = os.path.split(os.path.realpath(path))
        parent, item_id = os.path.split(folder)
        if parent != self.layout.real_trash or not TRASH_ID_RE.fullmatch(item_id) or name == MANIFEST:
            return False
        with self.db.read() as conn:
            row = conn.execute("SELECT name, companions FROM trashed_files WHERE id = ?", (item_id,)).fetchone()
        return row is not None and (name == row[0] or name in json.loads(row[1]))

    def holder_of(self, path: str) -> tuple[str, str] | None:
        """For an output registered after its file went to the trash: the item that holds it and its path there."""
        if os.path.lexists(path):
            return None
        folder = os.path.realpath(os.path.dirname(os.path.abspath(path)))
        name = os.path.basename(path)
        with self.db.read() as conn:
            rows = conn.execute("SELECT id, name, companions FROM trashed_files WHERE folder = ? AND state IN ('moving', 'trashed')", (folder,)).fetchall()
        for item_id, main, companions in rows:
            if name == main or name in json.loads(companions):
                return item_id, os.path.join(self.layout.item_dir(item_id), name)
        return None

    def attach(self, output_id: str, item_id: str, name: str) -> None:
        with self.db.write(durable=True) as w:
            w.conn.execute("INSERT OR IGNORE INTO trashed_outputs (output_id, item_id, name) VALUES (?, ?, ?)", (output_id, item_id, name))

    # the collection pass

    def expire(self, now: int, days: int) -> list[str]:
        """Delete the files whose retention ran out, a lost file's from its loss; forget deleted outputs after the hour."""
        cutoff = now - days * DAY_MS
        busy = self.in_flight()
        with self.db.read() as conn:
            ids = [row[0] for row in conn.execute(f"SELECT id FROM trashed_files WHERE state = 'trashed' AND {CLOCK_SQL} < ?", (cutoff,)) if row[0] not in busy]
        freed = self.discard(ids, f"AND {CLOCK_SQL} < ?", (cutoff,))
        with self.db.write() as w:
            w.conn.execute("DELETE FROM gone_outputs WHERE gone_at < ?", (now - GONE_KEPT_MS,))
        return freed.ids

    def relieve(self, free: int, reserve: int) -> list[str]:
        """When the store's disk has less free space than the reserve, delete the oldest files in the trash until it would not."""
        if free >= reserve:
            return []
        busy = self.in_flight()
        with self.db.read() as conn:
            rows = conn.execute(f"SELECT id, bytes, lost_at FROM trashed_files WHERE state = 'trashed' ORDER BY {CLOCK_SQL}, id").fetchall()
        chosen: list[str] = []
        total = 0
        for item_id, size, lost_at in rows:
            if item_id in busy:
                continue
            chosen.append(item_id)
            total += 0 if lost_at is not None else size
            if free + total >= reserve:
                break
        freed = self.discard(chosen)
        if freed.ids:
            log.warning(f"Gallery trash: {len(freed.ids)} files deleted, {size_text(freed.bytes)}, to keep {size_text(reserve)} free on the store's disk")
        return freed.ids

    def check(self) -> list[str]:
        """Each file in the trash that no request is moving checked against its folder; the items marked lost or found."""
        busy = self.in_flight()
        with self.db.read() as conn:
            rows = [Row.of(row) for row in conn.execute("SELECT * FROM trashed_files WHERE state = 'trashed'")]
        result = Reconciled()
        changed = [row.id for row in rows if row.id not in busy and self.check_present(row, result)]
        log_lost(result.lost)
        if result.found:
            log.info(f"Gallery trash: found={result.found}, lost files back in the trash")
        return changed

    def empty_gone(self) -> None:
        with contextlib.suppress(OSError):
            for name in os.listdir(self.layout.gone):
                path = os.path.join(self.layout.gone, name)
                if os.path.isdir(path) and not os.path.islink(path):
                    shutil.rmtree(path, ignore_errors=True)
                else:
                    with contextlib.suppress(OSError):
                        os.remove(path)

    def sweep(self, now: int, days: int) -> int:
        """Empty .gone/, take back folders a manifest names but no row does, and remove other folders under trash/ once
        older than the trash days; the folders removed."""
        self.empty_gone()
        busy = self.in_flight()
        with self.db.read() as conn:
            known = {row[0] for row in conn.execute("SELECT id FROM trashed_files")}
        removed = strays = 0
        for name in self.unknown(known | busy):
            path = os.path.join(self.layout.trash, name)
            if self.adopt(name):
                continue
            try:
                age = now - mtime_ms(os.lstat(path))
            except OSError:
                continue
            if age <= days * DAY_MS:
                strays += 1
                continue
            if os.path.isdir(path) and not os.path.islink(path):
                shutil.rmtree(path, ignore_errors=True)
            else:
                with contextlib.suppress(OSError):
                    os.remove(path)
            removed += 1
            log.info(f"Gallery trash: {path}, held by no row, removed")
        self.strays = strays
        return removed

    def unknown(self, known: set[str]) -> list[str]:
        try:
            return sorted(name for name in os.listdir(self.layout.trash) if name not in known)
        except OSError:
            return []

    def adopt(self, item_id: str) -> bool:
        """Take back a folder whose row is gone when its manifest names a file it still holds."""
        if not TRASH_ID_RE.fullmatch(item_id):
            return False
        folder = self.layout.item_dir(item_id)
        manifest = read_manifest(folder)
        if manifest is None or manifest["id"] != item_id or not os.path.isfile(os.path.join(folder, manifest["name"])):
            return False
        companions = [name for name in manifest["companions"] if os.path.isfile(os.path.join(folder, name))]
        names = [manifest["name"], *companions]
        outputs = []
        for output_id, name in manifest["outputs"]:
            path = self.lookups.output_path(output_id)
            if name in names and path is not None and os.path.realpath(path) == os.path.realpath(os.path.join(folder, name)):
                outputs.append((output_id, name))
        sizes = 0
        for name in names:
            with contextlib.suppress(OSError):
                sizes += os.lstat(os.path.join(folder, name)).st_size
        with self.db.write(durable=True) as w:
            if w.conn.execute("SELECT 1 FROM trashed_files WHERE id = ?", (item_id,)).fetchone():
                return False
            w.conn.execute(
                "INSERT INTO trashed_files (id, state, name, folder, companions, kind, size, bytes, mtime, trashed_at, trashed_by) VALUES (?, 'trashed', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (item_id, manifest["name"], manifest["folder"], json.dumps(companions), kind_of(manifest["name"]), manifest["size"], sizes, manifest["mtime"], manifest["trashed_at"], manifest.get("trashed_by")),
            )
            w.conn.executemany("INSERT OR IGNORE INTO trashed_outputs (output_id, item_id, name) VALUES (?, ?, ?)", [(output_id, item_id, name) for output_id, name in outputs])
        log.info(f'Gallery trash: "{manifest["name"]}" taken back in from its manifest')
        return True

    # start

    def reconcile(self) -> Reconciled:
        """Settle what a crash left, before any route serves: rows mid-move by where their file is, the other rows against
        their files, and folders without a row taken back in from their manifest."""
        result = Reconciled()
        self.empty_gone()
        with self.db.read() as conn:
            rows = [Row.of(row) for row in conn.execute("SELECT * FROM trashed_files")]
        for row in rows:
            try:
                if row.state == "moving":
                    self.settle_moving(row, result)
                elif row.state == "restoring":
                    self.settle_restoring(row, result)
                else:
                    self.check_present(row, result)
            except OSError as e:
                log.warning(f'Gallery trash: "{row.name}" ({row.id}) left as it was: {e}')
        for name in self.unknown({row.id for row in rows}):
            if self.adopt(name):
                result.adopted += 1
            else:
                result.strays += 1
        self.strays = result.strays
        log_lost(result.lost)
        if result.trashed or result.dropped or result.restored or result.returned or result.found or result.adopted:
            log.info(f"Gallery trash: settled moved in={result.trashed} never left={result.dropped} restored={result.restored} back in the trash={result.returned} found={result.found} taken back={result.adopted}")
        if result.strays:
            log.info(f"Gallery trash: {result.strays} folders under {self.layout.trash} have no row; they go after the trash days")
        return result

    def mark_lost(self, item_id: str) -> None:
        with self.db.write(durable=True) as w:
            w.conn.execute("UPDATE trashed_files SET state = 'trashed', restore_to = NULL, lost_at = COALESCE(lost_at, ?) WHERE id = ?", (self.now(), item_id))

    def check_present(self, row: Row, result: Reconciled) -> bool:
        """Mark a trashed file lost when it left its folder and clear the mark when it is back; whether the row changed.
        A row that left the trash meanwhile is not touched."""
        present = os.path.isfile(os.path.join(self.layout.item_dir(row.id), row.name))
        if present == (row.lost_at is None):
            return False
        with self.db.write(durable=True) as w:
            if present:
                changed = w.conn.execute("UPDATE trashed_files SET lost_at = NULL WHERE id = ? AND state = 'trashed'", (row.id,)).rowcount
            else:
                changed = w.conn.execute("UPDATE trashed_files SET lost_at = ? WHERE id = ? AND state = 'trashed' AND lost_at IS NULL", (self.now(), row.id)).rowcount
        if present:
            result.found += changed
        else:
            result.lost += changed
        return changed > 0

    def settle_moving(self, row: Row, result: Reconciled) -> None:
        folder = self.layout.item_dir(row.id)
        if not os.path.lexists(os.path.join(folder, row.name)):
            if os.path.lexists(os.path.join(row.folder, row.name)):
                # The file never left; its folder holds at most a part
                shutil.rmtree(folder, ignore_errors=True)
                with self.db.write(durable=True) as w:
                    w.conn.execute("DELETE FROM trashed_files WHERE id = ?", (row.id,))
                result.dropped += 1
            else:
                self.mark_lost(row.id)
                result.lost += 1
            return
        names = []
        for name in row.names():
            home, here = os.path.join(row.folder, name), os.path.join(folder, name)
            if not os.path.lexists(here):
                continue
            if os.path.lexists(home) and twins(home, here):
                os.unlink(home)
            names.append(name)
        with contextlib.suppress(FileNotFoundError):
            os.unlink(os.path.join(folder, f".enso-{row.id}.part"))
        outputs = [(output_id, name) for output_id, name in self.outputs_of(row.id) if name in names]
        self.lookups.repath_outputs([(output_id, os.path.join(folder, name)) for output_id, name in outputs])
        size = sum(os.lstat(os.path.join(folder, name)).st_size for name in names)
        settled = Row(row.id, "trashed", row.name, row.folder, tuple(names[1:]), row.kind, row.size, size, row.mtime, row.trashed_at, row.trashed_by, None, None, None)
        write_manifest(folder, settled, outputs)
        with self.db.write(durable=True) as w:
            w.conn.execute("UPDATE trashed_files SET state = 'trashed', companions = ?, bytes = ? WHERE id = ?", (json.dumps(names[1:]), size, row.id))
            w.conn.execute(f"DELETE FROM trashed_outputs WHERE item_id = ? AND name NOT IN ({marks(len(names))})", [row.id, *names])
        result.trashed += 1

    def settle_restoring(self, row: Row, result: Reconciled) -> None:
        folder = self.layout.item_dir(row.id)
        inside = os.path.join(folder, row.name)
        target = row.restore_to
        if target is not None:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(os.path.join(os.path.dirname(target), f".enso-{row.id}.part"))
        if target is not None and matches(target, row.size, row.mtime):
            if os.path.lexists(inside) and twins(inside, target):
                os.unlink(inside)
            stem, new_stem = os.path.splitext(row.name)[0], os.path.splitext(os.path.basename(target))[0]
            moved = {row.name: target}
            left = []
            for companion in row.companions:
                here = os.path.join(folder, companion)
                there = os.path.join(os.path.dirname(target), rename_companion(companion, stem, new_stem))
                if not os.path.lexists(here):
                    if os.path.lexists(there):
                        moved[companion] = there
                    continue
                if os.path.lexists(there):
                    if twins(here, there):
                        os.unlink(here)
                        moved[companion] = there
                    else:
                        left.append(companion)
                    continue
                try:
                    place(here, there)
                    moved[companion] = there
                except OSError:
                    left.append(companion)
            self.finish_restore(row, moved, left)
            result.restored += 1
        elif os.path.lexists(inside):
            with self.db.write(durable=True) as w:
                w.conn.execute("UPDATE trashed_files SET state = 'trashed', restore_to = NULL WHERE id = ?", (row.id,))
            result.returned += 1
        else:
            self.mark_lost(row.id)
            result.lost += 1
