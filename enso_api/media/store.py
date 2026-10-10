"""Blobs by SHA-256: a file per hash under blobs/, a row per file in media.db, and the links that name them."""

import contextlib
import json
import logging
import os
import re
import shutil
import sys
import time
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass
from typing import NamedTuple

from enso_api.media import settings as policy
from enso_api.media.ingest import BATCH, Finished, Inflight, Sink
from enso_api.media.layout import HASH_RE, LEGACY_RE, Layout
from enso_api.media.sniff import sniff
from enso_api.sqlite import Database

log = logging.getLogger("sd")

LEGACY_FILE_RE = re.compile(r"([0-9a-f]{16})\.[A-Za-z0-9]+")
IN_CHUNK = 500


def now_ms() -> int:
    return time.time_ns() // 1_000_000


def chunks(items: list, size: int = IN_CHUNK) -> Iterator[list]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def marks(count: int) -> str:
    return ",".join("?" * count)


def fsync_dir(path: str) -> None:
    """Make a rename or a new entry in the folder durable; Windows has no directory handles to sync."""
    if sys.platform == "win32":
        return
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


@dataclass(frozen=True)
class BlobRow:
    hash: str
    ext: str
    size: int
    type: str
    created_at: int
    touched_at: int
    unnamed_since: int | None
    transient: bool
    lost_at: int | None

    @classmethod
    def from_row(cls, row) -> "BlobRow":
        return cls(row["hash"], row["ext"], row["size"], row["type"], row["created_at"], row["touched_at"], row["unnamed_since"], bool(row["transient"]), row["lost_at"])


class Claim(NamedTuple):
    present: list[str]
    missing: list[str]
    lost: list[str]


class Term(NamedTuple):
    count: int
    bytes: int


@dataclass(frozen=True)
class MediaReport:
    count: int
    bytes: int
    by_term: dict[str, Term]
    lost: int
    transient: int
    snapshots: Term
    corrupt: Term
    free: int
    total: int
    last_gc: int | None
    last_verify: dict | None


class SnapshotExists(Exception):
    """A snapshot of the same millisecond is already there."""


def folder_term(path: str) -> Term:
    count = size = 0
    with contextlib.suppress(OSError), os.scandir(path) as entries:
        for entry in entries:
            with contextlib.suppress(OSError):
                if entry.is_file(follow_symlinks=False):
                    count += 1
                    size += entry.stat(follow_symlinks=False).st_size
    return Term(count, size)


class MediaStore:
    def __init__(self, layout: Layout, db: Database, now: Callable[[], int] = now_ms, inflight: Inflight | None = None):
        self.layout = layout
        self.db = db
        self.now = now
        self.inflight = inflight or Inflight()
        self.settings_logged: set[str] = set()

    # bytes

    def path(self, row: BlobRow) -> str:
        return self.layout.blob_path(row.hash, row.ext)

    def file_ok(self, row: BlobRow) -> bool:
        """The row's file is there at the row's size."""
        try:
            return os.stat(self.path(row)).st_size == row.size
        except OSError:
            return False

    def place(self, finished: Finished, part_path: str, transient: bool) -> tuple[BlobRow, bool]:
        """Take a finished part in: dropped when the blob is already held, else renamed into place; the row and whether it is new.

        The rename, the folder's fsync and the row are one critical section under the write lock.
        """
        now = self.now()
        with self.db.write() as w:
            found = w.conn.execute("SELECT * FROM blobs WHERE hash = ?", (finished.digest,)).fetchone()
            existing = BlobRow.from_row(found) if found else None
            if existing is not None and existing.lost_at is None and self.file_ok(existing):
                os.remove(part_path)
                w.conn.execute("UPDATE blobs SET touched_at = ?, transient = transient AND ? WHERE hash = ?", (now, int(transient), finished.digest))
            else:
                if existing is not None:
                    ext, kind = existing.ext, existing.type
                else:
                    sniffed = sniff(finished.head)
                    ext, kind = sniffed.ext, sniffed.type
                fan = self.layout.fan_dir(finished.digest)
                if not os.path.isdir(fan):
                    os.makedirs(fan, exist_ok=True)
                    fsync_dir(self.layout.blobs)
                os.replace(part_path, self.layout.blob_path(finished.digest, ext))
                fsync_dir(fan)
                w.conn.execute(
                    "INSERT INTO blobs (hash, ext, size, type, created_at, touched_at, unnamed_since, transient) VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
                    "ON CONFLICT(hash) DO UPDATE SET size = excluded.size, touched_at = excluded.touched_at, lost_at = NULL, transient = blobs.transient AND excluded.transient",
                    (finished.digest, ext, finished.size, kind, now, now, now, int(transient)),
                )
            row = BlobRow.from_row(w.conn.execute("SELECT * FROM blobs WHERE hash = ?", (finished.digest,)).fetchone())
        return row, existing is None

    def ingest_chunks(self, chunks_in: Iterable[bytes], declared: int, transient: bool = False) -> tuple[BlobRow, bool]:
        """Bytes the server reads itself, through the same sink and place as an upload; the row and whether it is new."""
        part = self.layout.new_part()
        token = self.inflight.register(declared, part)
        sink = None
        try:
            sink = Sink(part)
            for data in chunks_in:
                sink.write(data)
            return self.place(sink.close(), part, transient)
        except BaseException:
            if sink is not None:
                sink.abort()
            raise
        finally:
            self.inflight.release(token)

    def ingest_bytes(self, data: bytes, transient: bool = False) -> tuple[BlobRow, bool]:
        return self.ingest_chunks([data], len(data), transient)

    def ingest_file(self, path: str, transient: bool = False) -> tuple[BlobRow, bool]:
        with open(path, "rb") as f:
            return self.ingest_chunks(iter(lambda: f.read(BATCH), b""), os.fstat(f.fileno()).st_size, transient)

    def row(self, digest: str) -> BlobRow | None:
        """The row as stored, lost or not."""
        if not isinstance(digest, str) or not HASH_RE.fullmatch(digest):
            return None
        with self.db.read() as conn:
            found = conn.execute("SELECT * FROM blobs WHERE hash = ?", (digest,)).fetchone()
        return BlobRow.from_row(found) if found else None

    def get(self, digest: str) -> BlobRow | None:
        """A held blob; None for an unknown or lost one, or one whose file is gone. Never writes."""
        found = self.row(digest)
        if found is None or found.lost_at is not None or not self.file_ok(found):
            return None
        return found

    def path_of(self, digest: str) -> str | None:
        found = self.get(digest)
        return self.path(found) if found else None

    def held(self, hashes: Iterable[str]) -> set[str]:
        """The hashes whose blob is held: a row not marked lost, its file there at its size. Never writes."""
        wanted = sorted({h for h in hashes if isinstance(h, str) and HASH_RE.fullmatch(h)})
        found: set[str] = set()
        with self.db.read() as conn:
            for part in chunks(wanted):
                for row in conn.execute(f"SELECT * FROM blobs WHERE hash IN ({marks(len(part))}) AND lost_at IS NULL", part):
                    blob = BlobRow.from_row(row)
                    if self.file_ok(blob):
                        found.add(blob.hash)
        return found

    def claim(self, hashes: list[str]) -> Claim:
        """Sort hashes into present, missing and lost; the present ones are kept (touched, no longer transient), the lost ones marked.

        The files are stat'ed outside the lock and the lost ones again inside it, since an ingest may heal one meanwhile.
        """
        wanted = list(dict.fromkeys(h for h in hashes if isinstance(h, str)))
        valid = [h for h in wanted if HASH_RE.fullmatch(h)]
        rows: dict[str, BlobRow] = {}
        with self.db.read() as conn:
            for part in chunks(valid):
                for found in conn.execute(f"SELECT * FROM blobs WHERE hash IN ({marks(len(part))})", part):
                    rows[found["hash"]] = BlobRow.from_row(found)
        present, missing, lost = [], [], []
        for h in wanted:
            found = rows.get(h)
            if found is None:
                missing.append(h)
            elif found.lost_at is None and self.file_ok(found):
                present.append(h)
            else:
                lost.append(h)
        if present or lost:
            now = self.now()
            # Under the lock a row without lost_at has its file: the collector and verify change both only while holding it
            states: dict[str, int | None] = {}
            with self.db.write() as w:
                for part in chunks(present):
                    states.update((row[0], row[1]) for row in w.conn.execute(f"SELECT hash, lost_at FROM blobs WHERE hash IN ({marks(len(part))})", part))
                    w.conn.execute(f"UPDATE blobs SET touched_at = ?, transient = 0 WHERE hash IN ({marks(len(part))}) AND lost_at IS NULL", [now, *part])
                for h in lost:
                    current = w.conn.execute("SELECT * FROM blobs WHERE hash = ?", (h,)).fetchone()
                    if current is not None and current["lost_at"] is None and not self.file_ok(BlobRow.from_row(current)):
                        w.conn.execute("UPDATE blobs SET lost_at = ? WHERE hash = ?", (now, h))
            # Collected or marked lost between the read and the write
            missing.extend(h for h in present if h not in states)
            lost.extend(h for h in present if states.get(h) is not None)
            present = [h for h in present if h in states and states[h] is None]
        return Claim(present, missing, lost)

    # refs, as sdnext and the queue see them

    def resolve_ref(self, ref_id: str) -> str | None:
        """The hash a ref id names: a hash as it is, a 16-hex id of a taken-in upload through legacy_uploads."""
        if not isinstance(ref_id, str):
            return None
        if HASH_RE.fullmatch(ref_id):
            return ref_id
        if LEGACY_RE.fullmatch(ref_id):
            with self.db.read() as conn:
                found = conn.execute("SELECT hash FROM legacy_uploads WHERE id = ?", (ref_id,)).fetchone()
            return found[0] if found else None
        return None

    def resolve_to_path(self, ref_id: str) -> str | None:
        digest = self.resolve_ref(ref_id)
        return self.path_of(digest) if digest else None

    def resolve_to_image(self, ref_id: str):
        """sdnext's upload-store contract: a PIL image, or None."""
        path = self.resolve_to_path(ref_id)
        if path is None:
            return None
        from PIL import Image

        return Image.open(path)

    def holds(self, ref_id: str) -> bool:
        return self.resolve_to_path(ref_id) is not None

    def name_job(self, job_id: str, refs: Iterable[str]) -> list[str]:
        """Name the blobs a job's refs resolve to until the job is released; the refs whose blob the store does not hold, left unnamed."""
        resolved = {ref: self.resolve_ref(ref) for ref in set(refs)}
        hashes = sorted({h for h in resolved.values() if h})
        absent: set[str] = set()
        if hashes:
            now = self.now()
            with self.db.write() as w:
                for part in chunks(hashes):
                    rows = {row["hash"]: BlobRow.from_row(row) for row in w.conn.execute(f"SELECT * FROM blobs WHERE hash IN ({marks(len(part))})", part)}
                    for h in part:
                        row = rows.get(h)
                        if row is None or row.lost_at is not None or not self.file_ok(row):
                            absent.add(h)
                        else:
                            w.conn.execute("INSERT OR IGNORE INTO job_blobs (job_id, hash, named_at) VALUES (?, ?, ?)", (job_id, h, now))
        return sorted(ref for ref, h in resolved.items() if h is None or h in absent)

    def release_job(self, job_id: str) -> None:
        with self.db.write() as w:
            w.conn.execute("DELETE FROM job_blobs WHERE job_id = ?", (job_id,))

    def jobs_named(self) -> set[str]:
        with self.db.read() as conn:
            return {row[0] for row in conn.execute("SELECT DISTINCT job_id FROM job_blobs")}

    # policy and state

    def settings(self) -> policy.Settings:
        with self.db.read() as conn:
            raw = {row[0]: row[1] for row in conn.execute("SELECT key, value FROM settings")}
        for problem in policy.problems(raw):
            if problem not in self.settings_logged:
                self.settings_logged.add(problem)
                log.warning(f"Media store: stored setting {problem}; the nearest allowed value applies")
        return policy.clamp(raw)

    def update_settings(self, patch: dict[str, int]) -> policy.Settings:
        """Write the given settings, clamped again; the others stay."""
        given = {key: value for key, value in patch.items() if key in policy.BOUNDS}
        clamped = policy.clamp({key: str(value) for key, value in given.items()}).as_dict()
        with self.db.write() as w:
            for key in given:
                w.conn.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, str(clamped[key])))
        return self.settings()

    def meta(self, key: str) -> str | None:
        with self.db.read() as conn:
            found = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return found[0] if found else None

    def set_meta(self, key: str, value: str) -> None:
        with self.db.write() as w:
            w.conn.execute("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))

    def report(self) -> MediaReport:
        """Held blobs by the first term that names them: an entry in the library, a record or a job, an entry in the trash, none."""
        terms = {name: Term(0, 0) for name in ("library", "records", "trash", "unnamed")}
        with self.db.read(snapshot=True) as conn:
            for name, count, size in conn.execute(
                """
                SELECT CASE
                  WHEN EXISTS (SELECT 1 FROM entry_blobs eb JOIN entries e ON e.id = eb.entry_id WHERE eb.hash = b.hash AND e.trashed_at IS NULL) THEN 'library'
                  WHEN EXISTS (SELECT 1 FROM record_blobs rb WHERE rb.hash = b.hash) OR EXISTS (SELECT 1 FROM job_blobs jb WHERE jb.hash = b.hash) THEN 'records'
                  WHEN EXISTS (SELECT 1 FROM entry_blobs eb WHERE eb.hash = b.hash) THEN 'trash'
                  ELSE 'unnamed'
                END AS term, COUNT(*), COALESCE(SUM(size), 0)
                FROM blobs b WHERE b.lost_at IS NULL GROUP BY term
                """
            ):
                terms[name] = Term(count, size)
            lost = conn.execute("SELECT COUNT(*) FROM blobs WHERE lost_at IS NOT NULL").fetchone()[0]
            transient = conn.execute("SELECT COUNT(*) FROM blobs WHERE transient = 1 AND lost_at IS NULL").fetchone()[0]
            stored = {row[0]: row[1] for row in conn.execute("SELECT key, value FROM meta WHERE key IN ('last_gc', 'last_verify')")}
        usage = shutil.disk_usage(self.layout.root)
        last_verify = None
        with contextlib.suppress(TypeError, ValueError):
            last_verify = json.loads(stored["last_verify"]) if "last_verify" in stored else None
        last_gc = None
        with contextlib.suppress(ValueError):
            last_gc = int(stored["last_gc"]) if "last_gc" in stored else None
        return MediaReport(
            count=sum(term.count for term in terms.values()),
            bytes=sum(term.bytes for term in terms.values()),
            by_term=terms,
            lost=lost,
            transient=transient,
            snapshots=folder_term(self.layout.snapshots),
            corrupt=folder_term(self.layout.corrupt),
            free=usage.free,
            total=usage.total,
            last_gc=last_gc,
            last_verify=last_verify if isinstance(last_verify, dict) else None,
        )

    def snapshot(self) -> tuple[str, int]:
        """A consistent copy of media.db in snapshots/, named by the UTC millisecond; the path and its bytes."""
        stamp = self.now()
        name = f"media-{time.strftime('%Y%m%d-%H%M%S', time.gmtime(stamp // 1000))}-{stamp % 1000:03d}.db"
        path = os.path.join(self.layout.snapshots, name)
        try:
            os.close(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644))
        except FileExistsError as e:
            raise SnapshotExists(path) from e
        try:
            return path, self.db.backup(path)
        except BaseException:
            with contextlib.suppress(OSError):
                os.remove(path)
            raise

    def under_root(self, path: str) -> bool:
        return self.layout.under_root(path)

    def take_legacy_uploads(self, folder: str) -> int:
        """Take in the uploads an earlier build staged, under their old ids, as transient blobs; the folder goes once empty."""
        if not os.path.isdir(folder):
            return 0
        taken = 0
        for name in sorted(os.listdir(folder)):
            match = LEGACY_FILE_RE.fullmatch(name)
            path = os.path.join(folder, name)
            if not match or not os.path.isfile(path):
                continue
            try:
                row, _ = self.ingest_file(path, transient=True)
                with self.db.write() as w:
                    w.conn.execute("INSERT INTO legacy_uploads (id, hash) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET hash = excluded.hash", (match.group(1), row.hash))
                os.remove(path)
                taken += 1
            except OSError as e:
                log.warning(f"Media store: upload {path} not taken in: {e}")
        with contextlib.suppress(OSError):
            os.rmdir(folder)
        return taken
