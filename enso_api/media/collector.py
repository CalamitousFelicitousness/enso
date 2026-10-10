"""Collection: what goes is decided by a pure plan over one survey, then applied in short batches under the write lock.

Named wins: a blob goes only when no link names it, past its grace, and untouched for an hour.
"""

import contextlib
import logging
import os
import re
import sqlite3
from collections import Counter, defaultdict
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

from enso_api import events
from enso_api.media.ingest import Inflight, hash_file
from enso_api.media.layout import Layout
from enso_api.media.settings import Settings
from enso_api.media.sniff import EXTENSIONS, sniff
from enso_api.media.store import BlobRow, MediaStore, chunks, marks

log = logging.getLogger("sd")

HOUR_MS = 3600 * 1000
DAY_MS = 24 * HOUR_MS
GRACE_MS = 7 * DAY_MS
TRANSIENT_GRACE_MS = HOUR_MS
URGENT_TOUCH_MS = HOUR_MS
PART_AGE_MS = HOUR_MS
PASS_SECONDS = 300
PASS_MS = PASS_SECONDS * 1000
FUTURE_SLACK_MS = 5 * 60 * 1000
STRIP_RETENTION_MS = 168 * HOUR_MS
STRIP_DOMAINS = frozenset({"generate", "video", "framepack", "ltx"})
DELETE_BATCH = 50

LiveJobs = Callable[[], "set[str] | None"]


@dataclass(frozen=True)
class JobName:
    job_id: str
    hash: str
    named_at: int


@dataclass(frozen=True)
class TrashedEntry:
    id: str
    trashed_at: int


@dataclass(frozen=True)
class RecordRow:
    job_id: str
    client: str
    created_at: int
    routed: bool
    domain: str


@dataclass(frozen=True)
class Part:
    path: str
    mtime_ms: int
    registered: bool


@dataclass(frozen=True)
class Survey:
    """Everything plan() looks at, read in one snapshot."""

    now: int
    settings: Settings
    live_jobs: frozenset[str] | None  # pending and running rows and the runners in flight; None before the queue runs
    job_names: tuple[JobName, ...] = ()
    trashed: tuple[TrashedEntry, ...] = ()
    trashed_links: tuple[tuple[str, str], ...] = ()  # entry id, hash, for trashed entries only
    name_counts: Mapping[str, int] = field(default_factory=dict)  # names across the three link tables, for those hashes
    records: tuple[RecordRow, ...] = ()
    candidates: tuple[BlobRow, ...] = ()  # blobs with unnamed_since or lost_at set
    parts: tuple[Part, ...] = ()
    last_gc: int | None = None


@dataclass(frozen=True)
class Plan:
    now: int
    trash_ms: int
    drop_job_names: tuple[str, ...] = ()
    delete_entries: tuple[str, ...] = ()
    retire_records: tuple[str, ...] = ()
    delete_blobs: tuple[str, ...] = ()  # unnamed past the grace
    urgent_blobs: tuple[str, ...] = ()  # named only by the expiring entries
    delete_parts: tuple[str, ...] = ()
    rebase: bool = False  # last_gc absent, older than the grace, or ahead of now: delete nothing, restart every clock


@dataclass
class Applied:
    names: int = 0
    entries: int = 0
    records: int = 0
    blobs: int = 0
    bytes: int = 0
    parts: int = 0
    kept: int = 0  # planned blobs that were named or touched since the plan
    rebased: int = 0

    def changed(self) -> bool:
        return bool(self.names or self.entries or self.records or self.blobs or self.parts or self.rebased)


def survey(store: MediaStore, layout: Layout, inflight: Inflight, live_jobs: LiveJobs) -> Survey:
    now = store.now()
    settings = store.settings()
    live = live_jobs()
    with store.db.read(snapshot=True) as conn:
        job_names = tuple(JobName(*row) for row in conn.execute("SELECT job_id, hash, named_at FROM job_blobs"))
        trashed = tuple(TrashedEntry(*row) for row in conn.execute("SELECT id, trashed_at FROM entries WHERE trashed_at IS NOT NULL"))
        trashed_links = tuple((row[0], row[1]) for row in conn.execute("SELECT eb.entry_id, eb.hash FROM entry_blobs eb JOIN entries e ON e.id = eb.entry_id WHERE e.trashed_at IS NOT NULL"))
        name_counts: dict[str, int] = {}
        for part in chunks(sorted({h for _, h in trashed_links})):
            for h, count in conn.execute(
                f"SELECT hash, COUNT(*) FROM (SELECT hash FROM entry_blobs UNION ALL SELECT hash FROM record_blobs UNION ALL SELECT hash FROM job_blobs) WHERE hash IN ({marks(len(part))}) GROUP BY hash",
                part,
            ):
                name_counts[h] = count
        records = tuple(RecordRow(row[0], row[1], row[2], bool(row[3]), row[4]) for row in conn.execute("SELECT job_id, client, created_at, routed, domain FROM records"))
        candidates = tuple(BlobRow.from_row(row) for row in conn.execute("SELECT * FROM blobs WHERE unnamed_since IS NOT NULL OR lost_at IS NOT NULL"))
        last = conn.execute("SELECT value FROM meta WHERE key = 'last_gc'").fetchone()
    registered = inflight.parts()
    parts = []
    with contextlib.suppress(OSError), os.scandir(layout.tmp) as entries:
        for entry in entries:
            if entry.name.endswith(".part"):
                with contextlib.suppress(OSError):
                    parts.append(Part(entry.path, entry.stat().st_mtime_ns // 1_000_000, entry.path in registered))
    last_gc = None
    with contextlib.suppress(TypeError, ValueError):
        last_gc = int(last[0]) if last else None
    return Survey(now, settings, frozenset(live) if live is not None else None, job_names, trashed, trashed_links, name_counts, records, candidates, tuple(parts), last_gc)


def plan(s: Survey) -> Plan:
    trash_ms = s.settings.trash_days * DAY_MS
    if s.last_gc is None or s.last_gc < s.now - GRACE_MS or s.last_gc > s.now + FUTURE_SLACK_MS:
        return Plan(s.now, trash_ms, rebase=True)
    live = s.live_jobs

    drop: list[str] = []
    if live is not None:
        newest: dict[str, int] = {}
        for name in s.job_names:
            newest[name.job_id] = max(newest.get(name.job_id, name.named_at), name.named_at)
        # A name younger than a pass may belong to a job whose row is not written yet
        drop = sorted(job_id for job_id, named_at in newest.items() if job_id not in live and named_at < s.now - PASS_MS)

    expiring = sorted(entry.id for entry in s.trashed if entry.trashed_at < s.now - trash_ms)
    expiring_set = set(expiring)
    freed = Counter(h for entry_id, h in s.trashed_links if entry_id in expiring_set)
    urgent = sorted(h for h, count in freed.items() if s.name_counts.get(h, 0) == count)

    retire: list[str] = []
    if live is not None:
        by_client: dict[str, list[RecordRow]] = defaultdict(list)
        for record in s.records:
            by_client[record.client].append(record)
        for rows in by_client.values():
            excess = len(rows) - s.settings.record_cap
            for record in sorted(rows, key=lambda row: (row.created_at, row.job_id)):
                if excess <= 0:
                    break
                if record.job_id in live:
                    continue
                if not record.routed and record.domain in STRIP_DOMAINS and record.created_at > s.now - STRIP_RETENTION_MS:
                    continue
                retire.append(record.job_id)
                excess -= 1

    touched_before = s.now - URGENT_TOUCH_MS
    delete = sorted(blob.hash for blob in s.candidates if blob.unnamed_since is not None and blob.unnamed_since < s.now - (TRANSIENT_GRACE_MS if blob.transient else GRACE_MS) and blob.touched_at < touched_before)
    parts = sorted(part.path for part in s.parts if not part.registered and part.mtime_ms < s.now - PART_AGE_MS)
    return Plan(s.now, trash_ms, tuple(drop), tuple(expiring), tuple(retire), tuple(delete), tuple(urgent), tuple(parts))


def delete_blobs(store: MediaStore, hashes: tuple[str, ...], predicate: str, binds: tuple, applied: Applied) -> None:
    """Rows first, one statement per blob, committed before the files go while the lock is still held, in batches that release it."""
    for batch in chunks(list(hashes), DELETE_BATCH):
        gone: list[BlobRow] = []
        with store.db.write() as w:
            for h in batch:
                found = w.conn.execute("SELECT * FROM blobs WHERE hash = ?", (h,)).fetchone()
                try:
                    deleted = found is not None and w.conn.execute(f"DELETE FROM blobs WHERE hash = ? AND {predicate}", (h, *binds)).rowcount > 0
                except sqlite3.IntegrityError:
                    deleted = False
                if deleted:
                    gone.append(BlobRow.from_row(found))
                else:
                    applied.kept += 1
            w.commit()
            for blob in gone:
                try:
                    os.remove(store.path(blob))
                except FileNotFoundError:
                    pass
                except OSError as e:
                    # The file stays as a stray, adopted with a fresh grace by the next walk
                    log.warning(f"Media store: {blob.hash}.{blob.ext} left on disk: {e}")
                applied.blobs += 1
                applied.bytes += blob.size


def apply(store: MediaStore, p: Plan, live_jobs: LiveJobs) -> Applied:
    applied = Applied()
    if p.rebase:
        with store.db.write() as w:
            applied.rebased = w.conn.execute("UPDATE blobs SET unnamed_since = ? WHERE unnamed_since IS NOT NULL", (p.now,)).rowcount
            applied.rebased += w.conn.execute("UPDATE entries SET trashed_at = ? WHERE trashed_at IS NOT NULL", (p.now,)).rowcount
            w.conn.execute("INSERT INTO meta (key, value) VALUES ('last_gc', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (str(p.now),))
        log.info(f"Media store: collection clock restarted, nothing deleted this pass; graces and trash days restart for {applied.rebased} rows")
        return applied

    live = live_jobs() if p.drop_job_names or p.retire_records else None
    if live is not None:
        for batch in chunks([job_id for job_id in p.drop_job_names if job_id not in live], DELETE_BATCH):
            with store.db.write() as w:
                applied.names += w.conn.execute(f"DELETE FROM job_blobs WHERE job_id IN ({marks(len(batch))})", batch).rowcount
    for batch in chunks(list(p.delete_entries), DELETE_BATCH):
        with store.db.write() as w:
            for entry_id in batch:
                applied.entries += w.conn.execute("DELETE FROM entries WHERE id = ? AND trashed_at IS NOT NULL AND trashed_at < ?", (entry_id, p.now - p.trash_ms)).rowcount
    if live is not None:
        for batch in chunks([job_id for job_id in p.retire_records if job_id not in live], DELETE_BATCH):
            with store.db.write() as w:
                applied.records += w.conn.execute(f"DELETE FROM records WHERE job_id IN ({marks(len(batch))})", batch).rowcount
    touched_before = p.now - URGENT_TOUCH_MS
    grace = "unnamed_since IS NOT NULL AND unnamed_since < (CASE WHEN transient = 1 THEN ? ELSE ? END) AND touched_at < ?"
    delete_blobs(store, p.delete_blobs, grace, (p.now - TRANSIENT_GRACE_MS, p.now - GRACE_MS, touched_before), applied)
    delete_blobs(store, p.urgent_blobs, "unnamed_since IS NOT NULL AND touched_at < ?", (touched_before,), applied)
    registered = store.inflight.parts()
    for path in p.delete_parts:
        if path in registered:
            continue
        with contextlib.suppress(OSError):
            if os.stat(path).st_mtime_ns // 1_000_000 < p.now - PART_AGE_MS:
                os.remove(path)
                applied.parts += 1
    store.set_meta("last_gc", str(p.now))
    if applied.changed():
        events.bump("media")
        log.info(f"Media store: collected blobs={applied.blobs} size={applied.bytes} entries={applied.entries} records={applied.records} job names={applied.names} parts={applied.parts}")
    log.debug(f"Media store: pass done kept={applied.kept}")
    return applied


@dataclass
class Reconciled:
    lost: int = 0
    found: int = 0
    adopted: int = 0
    corrupt: int = 0
    unknown: list[str] = field(default_factory=list)


STRAY_RE = re.compile(r"([0-9a-f]{64})\.([a-z0-9]+)")
PAGE = 1000


def corrupt_path(layout: Layout, name: str, now: int) -> str:
    """A free name in corrupt/; an earlier file of the same name stays."""
    path = os.path.join(layout.corrupt, name)
    if not os.path.exists(path):
        return path
    stem, ext = os.path.splitext(name)
    return os.path.join(layout.corrupt, f"{stem}-{now}{ext}")


def signature(path: str) -> tuple[int, int, int]:
    st = os.stat(path)
    return st.st_ino, st.st_size, st.st_mtime_ns


def check_rows(store: MediaStore, walk: bool, result: Reconciled) -> None:
    """Mark rows whose file is gone lost and clear rows whose file is back: every row on a walk, else the unnamed and lost ones."""
    where = "" if walk else " AND (unnamed_since IS NOT NULL OR lost_at IS NOT NULL)"
    after = ""
    while True:
        with store.db.read() as conn:
            page = [BlobRow.from_row(row) for row in conn.execute(f"SELECT * FROM blobs WHERE hash > ?{where} ORDER BY hash LIMIT ?", (after, PAGE))]
        if not page:
            return
        after = page[-1].hash
        changed = [row for row in page if store.file_ok(row) == (row.lost_at is not None)]
        if not changed:
            continue
        now = store.now()
        with store.db.write() as w:
            for row in changed:
                current = w.conn.execute("SELECT * FROM blobs WHERE hash = ?", (row.hash,)).fetchone()
                if current is None:
                    continue
                blob = BlobRow.from_row(current)
                # Again under the lock: an ingest may have healed or replaced the file meanwhile
                present = store.file_ok(blob)
                if present and blob.lost_at is not None:
                    w.conn.execute("UPDATE blobs SET lost_at = NULL WHERE hash = ?", (blob.hash,))
                    result.found += 1
                elif not present and blob.lost_at is None:
                    w.conn.execute("UPDATE blobs SET lost_at = ? WHERE hash = ?", (now, blob.hash))
                    result.lost += 1


def take_stray(store: MediaStore, layout: Layout, path: str, digest: str, ext: str, result: Reconciled) -> None:
    """A blob file without a row: adopted with a fresh grace when its bytes hash to its name, else moved to corrupt/."""
    try:
        before = signature(path)
        actual, head = hash_file(path)
    except OSError:
        result.unknown.append(path)
        return
    now = store.now()
    with store.db.write() as w:
        if w.conn.execute("SELECT 1 FROM blobs WHERE hash = ?", (digest,)).fetchone():
            return
        try:
            if signature(path) != before:
                return
        except OSError:
            return
        if actual != digest:
            os.replace(path, corrupt_path(layout, os.path.basename(path), now))
            result.corrupt += 1
            return
        sniffed = sniff(head)
        if sniffed.ext != ext:
            result.unknown.append(path)
            return
        w.conn.execute(
            "INSERT INTO blobs (hash, ext, size, type, created_at, touched_at, unnamed_since, transient) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
            (digest, ext, before[1], sniffed.type, now, now, now),
        )
        result.adopted += 1


def walk_blobs(store: MediaStore, layout: Layout, result: Reconciled) -> None:
    try:
        fans = sorted(os.listdir(layout.blobs))
    except OSError:
        return
    for fan in fans:
        folder = os.path.join(layout.blobs, fan)
        if not os.path.isdir(folder):
            result.unknown.append(folder)
            continue
        for name in sorted(os.listdir(folder)):
            path = os.path.join(folder, name)
            match = STRAY_RE.fullmatch(name)
            if not match or match.group(1)[:2] != fan or match.group(2) not in EXTENSIONS or not os.path.isfile(path):
                result.unknown.append(path)
                continue
            digest, ext = match.groups()
            row = store.row(digest)
            if row is None:
                take_stray(store, layout, path, digest, ext, result)
            elif row.ext != ext:
                result.unknown.append(path)


def reconcile(store: MediaStore, layout: Layout, walk: bool) -> Reconciled:
    """Rows against files; with walk, the files under blobs/ against rows too."""
    result = Reconciled()
    check_rows(store, walk, result)
    if walk:
        walk_blobs(store, layout, result)
    if result.lost:
        log.warning(f"Media store: {result.lost} blobs lost, their files are gone")
    if result.found or result.adopted or result.corrupt:
        log.info(f"Media store: files back={result.found} taken in={result.adopted} moved to corrupt={result.corrupt}")
    if result.unknown:
        listed = ", ".join(result.unknown[:5]) + (" and more" if len(result.unknown) > 5 else "")
        log.warning(f"Media store: {len(result.unknown)} files under {layout.blobs} are not the store's and were left: {listed}")
    if result.lost or result.found or result.adopted or result.corrupt:
        events.bump("media")
    return result


def run_pass(store: MediaStore, live_jobs: LiveJobs) -> Applied:
    """One collection pass: the unnamed and lost rows checked against their files, then survey, plan and apply."""
    reconcile(store, store.layout, walk=False)
    return apply(store, plan(survey(store, store.layout, store.inflight, live_jobs)), live_jobs)
