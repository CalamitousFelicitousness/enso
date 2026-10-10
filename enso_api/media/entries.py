"""Library entries in media.db: saves under the cap and the pins, changes, the trash, and deletes.

The cap counts untrashed unpinned entries; past it the least recently used go to the trash, never the entry being written.
"""

import json
import sqlite3
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from enso_api.documents import check_entry, issue, missing_issues
from enso_api.media.settings import Settings
from enso_api.media.store import chunks, marks
from enso_api.sqlite import Database

MAX_PINNED = 20


class Refused(Exception):
    """A change the rules refuse: a status, a code and a message with fields, or an issue list."""

    def __init__(self, status: int, code: str, message: str, issues: list[dict] | None = None, **fields):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.issues = issues
        self.fields = fields


def refused_issues(issues: list[dict]) -> Refused:
    return Refused(422, "invalid", "The document names what the server cannot keep", issues=issues)


class Gone(Exception):
    """No row with that id."""


@dataclass(frozen=True)
class EntryIn:
    id: str
    kind: str
    name: str
    saved_at: int
    used_at: int
    pinned: bool
    trashed_at: int | None
    frames: int
    pictures: int
    role: str | None
    control: str | None
    width: int
    height: int
    inputs_schema: int
    inputs: Any
    maps: dict[str, str]
    hashes: dict[str, str]
    unavailable: list[str]
    thumbs: list[dict]  # cid, hash, thumb, width, height


@dataclass(frozen=True)
class EntryPatch:
    name: str | None = None
    pinned: bool | None = None
    used: bool = False
    trashed: bool | None = None


@dataclass(frozen=True)
class EntryRank:
    id: str
    used_at: int
    saved_at: int


@dataclass
class Changed:
    """An entry as it is after a save or a patch, and what the write did."""

    entry: dict
    pushed_out: list[dict] = field(default_factory=list)  # id, name
    created: bool = False
    unpinned: bool = False
    trash_moved: bool = False


@dataclass
class Deleted:
    ids: list[str] = field(default_factory=list)
    hashes: set[str] = field(default_factory=set)


def evictions(rows: Sequence[EntryRank], cap: int, keep: str | None) -> list[str]:
    """The ids past the cap among untrashed unpinned rows, least recently used first; `keep` never goes."""
    excess = len(rows) - cap
    gone: list[str] = []
    for row in sorted(rows, key=lambda r: (r.used_at, r.saved_at, r.id)):
        if len(gone) >= excess:
            break
        if row.id != keep:
            gone.append(row.id)
    return gone


def evict_in(conn: sqlite3.Connection, cap: int, keep: str | None, now: int, by: str | None) -> list[dict]:
    """Trash what the cap pushes out, inside the caller's write; the ids and names that went."""
    rows = [EntryRank(*row) for row in conn.execute("SELECT id, used_at, saved_at FROM entries WHERE trashed_at IS NULL AND pinned = 0")]
    gone = []
    for entry_id in evictions(rows, cap, keep):
        found = conn.execute(
            "UPDATE entries SET trashed_at = ?, trashed_by = ?, trashed_cause = 'evicted' WHERE id = ? AND trashed_at IS NULL AND pinned = 0 RETURNING id, name",
            (now, by, entry_id),
        ).fetchone()
        if found is not None:
            gone.append({"id": found[0], "name": found[1]})
    return gone


def evict_past_cap(db: Database, cap: int, now: int) -> list[str]:
    """The collection pass's share of the cap, read and applied in one write."""
    with db.write() as w:
        return [entry["id"] for entry in evict_in(w.conn, cap, None, now, None)]


def pinned_count(conn: sqlite3.Connection, other_than: str) -> int:
    return conn.execute("SELECT COUNT(*) FROM entries WHERE pinned = 1 AND trashed_at IS NULL AND id != ?", (other_than,)).fetchone()[0]


def unpinned_count(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COUNT(*) FROM entries WHERE pinned = 0 AND trashed_at IS NULL").fetchone()[0]


ITEM_SQL = "SELECT e.*, COALESCE(SUM(b.size), 0) AS bytes FROM entries e LEFT JOIN entry_blobs eb ON eb.entry_id = e.id LEFT JOIN blobs b ON b.hash = eb.hash"
LIBRARY_ORDER = "ORDER BY e.pinned DESC, e.used_at DESC, e.saved_at DESC, e.id"
TRASH_ORDER = "ORDER BY e.trashed_at DESC, e.id"


def lost_among(conn: sqlite3.Connection, hashes: Iterable[str]) -> set[str]:
    wanted = sorted(set(hashes))
    lost: set[str] = set()
    for part in chunks(wanted):
        lost.update(row[0] for row in conn.execute(f"SELECT hash FROM blobs WHERE hash IN ({marks(len(part))}) AND lost_at IS NOT NULL", part))
    return lost


def items(conn: sqlite3.Connection, rows: list[sqlite3.Row]) -> list[dict]:
    thumbs = {row["id"]: json.loads(row["thumbs"]) for row in rows}
    lost = lost_among(conn, (t["thumb"] for listed in thumbs.values() for t in listed))
    return [
        {
            "id": row["id"],
            "kind": row["kind"],
            "name": row["name"],
            "user": row["user"],
            "saved_at": row["saved_at"],
            "used_at": row["used_at"],
            "pinned": bool(row["pinned"]),
            "trashed_at": row["trashed_at"],
            "trashed_by": row["trashed_by"],
            "trashed_cause": row["trashed_cause"],
            "frames": row["frames"],
            "pictures": row["pictures"],
            "role": row["role"],
            "control": row["control"],
            "width": row["width"],
            "height": row["height"],
            "inputs_schema": row["schema"],
            "bytes": row["bytes"],
            "thumbs": [{**thumb, "lost": thumb["thumb"] in lost} for thumb in thumbs[row["id"]]],
        }
        for row in rows
    ]


class Entries:
    def __init__(self, db: Database, held: Callable[[Iterable[str]], set[str]], settings: Callable[[], Settings], now: Callable[[], int]):
        self.db = db
        self.held = held
        self.settings = settings
        self.now = now

    def item(self, conn: sqlite3.Connection, entry_id: str) -> dict | None:
        rows = conn.execute(f"{ITEM_SQL} WHERE e.id = ? GROUP BY e.id", (entry_id,)).fetchall()
        return items(conn, rows)[0] if rows else None

    def save(self, body: EntryIn, user: str | None, migrating: bool) -> Changed:
        """Store an entry; an id already stored answers the row as it is."""
        with self.db.read() as conn:
            existing = self.item(conn, body.id)
        if existing is not None:
            return Changed(existing)
        if body.trashed_at is not None and not migrating:
            raise refused_issues([issue(("body", "trashed_at"), "Only a migrated entry arrives in the trash", "not_migrating", body.trashed_at)])
        checked = check_entry(body.inputs, body.maps, body.hashes, body.unavailable, body.thumbs)
        if checked.issues:
            raise refused_issues(list(checked.issues))
        now = self.now()
        saved_at, used_at, trashed_at = (body.saved_at, body.used_at, body.trashed_at) if migrating else (now, now, None)
        document = json.dumps({"inputs": body.inputs, "maps": body.maps, "hashes": checked.hashes, "unavailable": list(checked.unavailable)})
        thumbs = json.dumps([{key: thumb[key] for key in ("cid", "hash", "thumb", "width", "height")} for thumb in body.thumbs])
        cap = self.settings().library_cap
        with self.db.write(durable=True) as w:
            existing = self.item(w.conn, body.id)
            if existing is not None:
                return Changed(existing)
            missing = checked.names - self.held(checked.names)
            if missing:
                raise refused_issues(missing_issues(missing, checked.locations))
            pinned, unpinned = body.pinned, False
            if pinned and trashed_at is None and pinned_count(w.conn, body.id) >= MAX_PINNED:
                if not migrating:
                    raise Refused(409, "pins_full", f"Up to {MAX_PINNED} entries can be pinned", max=MAX_PINNED)
                pinned, unpinned = False, True
            if migrating and trashed_at is None and not pinned:
                count = unpinned_count(w.conn)
                if count >= cap:
                    raise Refused(409, "library_full", f"The library holds {count} of {cap} entries", cap=cap, count=count)
            w.conn.execute(
                "INSERT INTO entries (id, kind, name, user, saved_at, used_at, pinned, trashed_at, trashed_by, trashed_cause, frames, pictures, role, control, width, height, schema, document, thumbs)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    body.id,
                    body.kind,
                    body.name,
                    user,
                    saved_at,
                    used_at,
                    int(pinned),
                    trashed_at,
                    None,
                    "removed" if trashed_at is not None else None,
                    body.frames,
                    body.pictures,
                    body.role,
                    body.control,
                    body.width,
                    body.height,
                    body.inputs_schema,
                    document,
                    thumbs,
                ),
            )
            w.conn.executemany("INSERT INTO entry_blobs (entry_id, hash) VALUES (?, ?)", [(body.id, h) for h in sorted(checked.names)])
            pushed = [] if migrating else evict_in(w.conn, cap, body.id, now, user)
            entry = self.item(w.conn, body.id)
        return Changed(entry, pushed, created=True, unpinned=unpinned)

    def patch(self, entry_id: str, change: EntryPatch, user: str | None) -> Changed:
        """Rename, pin, touch, trash or untrash; untrashing or unpinning applies the cap with the entry kept."""
        now = self.now()
        cap = self.settings().library_cap
        with self.db.write(durable=True) as w:
            row = w.conn.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
            if row is None:
                raise Gone(entry_id)
            sets: dict[str, Any] = {}
            unpinned = trash_moved = counted = False
            if change.name is not None:
                name = change.name.strip()
                if not name:
                    raise refused_issues([issue(("body", "name"), "A name needs a character that is not a space", "empty_name", change.name)])
                sets["name"] = name
            trashed = row["trashed_at"] is not None
            pinned = bool(row["pinned"])
            if change.trashed is True and not trashed:
                sets.update(trashed_at=now, trashed_by=user, trashed_cause="removed")
                trashed = trash_moved = True
            elif change.trashed is False and trashed:
                sets.update(trashed_at=None, trashed_by=None, trashed_cause=None, used_at=now)
                trashed, trash_moved, counted = False, True, True
                if pinned and pinned_count(w.conn, entry_id) >= MAX_PINNED:
                    sets["pinned"] = 0
                    pinned, unpinned = False, True
            if change.pinned is True and not pinned:
                if not trashed and pinned_count(w.conn, entry_id) >= MAX_PINNED:
                    raise Refused(409, "pins_full", f"Up to {MAX_PINNED} entries can be pinned", max=MAX_PINNED)
                sets["pinned"] = 1
            elif change.pinned is False and pinned:
                sets["pinned"] = 0
                counted = True
            if change.used:
                sets["used_at"] = now
            if sets:
                w.conn.execute(f"UPDATE entries SET {', '.join(f'{key} = ?' for key in sets)} WHERE id = ?", [*sets.values(), entry_id])
            pushed = evict_in(w.conn, cap, entry_id, now, user) if counted and not trashed else []
            entry = self.item(w.conn, entry_id)
        return Changed(entry, pushed, unpinned=unpinned, trash_moved=trash_moved)

    def list(self, trashed: bool, ids: Sequence[str] | None = None) -> list[dict]:
        """Untrashed entries, pinned first then by last use, or trashed ones newest first; with ids, those rows whatever their state."""
        with self.db.read(snapshot=True) as conn:
            if ids is not None:
                wanted = sorted(set(ids))
                rows = []
                for part in chunks(wanted):
                    rows.extend(conn.execute(f"{ITEM_SQL} WHERE e.id IN ({marks(len(part))}) GROUP BY e.id {LIBRARY_ORDER}", part).fetchall())
            elif trashed:
                rows = conn.execute(f"{ITEM_SQL} WHERE e.trashed_at IS NOT NULL GROUP BY e.id {TRASH_ORDER}").fetchall()
            else:
                rows = conn.execute(f"{ITEM_SQL} WHERE e.trashed_at IS NULL GROUP BY e.id {LIBRARY_ORDER}").fetchall()
            return items(conn, rows)

    def get(self, entry_id: str) -> dict | None:
        """The entry with its document and the cids whose bytes are lost."""
        with self.db.read(snapshot=True) as conn:
            entry = self.item(conn, entry_id)
            if entry is None:
                return None
            document = json.loads(conn.execute("SELECT document FROM entries WHERE id = ?", (entry_id,)).fetchone()[0])
            lost = lost_among(conn, document["hashes"].values())
        return {**entry, **document, "lost": sorted(cid for cid, digest in document["hashes"].items() if digest in lost)}

    def counts(self) -> tuple[int, int]:
        """Pinned entries, and untrashed unpinned ones."""
        with self.db.read(snapshot=True) as conn:
            pinned = conn.execute("SELECT COUNT(*) FROM entries WHERE pinned = 1 AND trashed_at IS NULL").fetchone()[0]
            return pinned, unpinned_count(conn)

    def delete(self, ids: Iterable[str]) -> Deleted:
        """Delete trashed entries; their links go with them and the triggers mark what nothing names now."""
        deleted = Deleted()
        with self.db.write(durable=True) as w:
            for entry_id in dict.fromkeys(ids):
                hashes = [row[0] for row in w.conn.execute("SELECT hash FROM entry_blobs WHERE entry_id = ?", (entry_id,))]
                if w.conn.execute("DELETE FROM entries WHERE id = ? AND trashed_at IS NOT NULL", (entry_id,)).rowcount:
                    deleted.ids.append(entry_id)
                    deleted.hashes.update(hashes)
        return deleted

    def reclaimable(self) -> int:
        """The bytes named by trashed entries and by nothing else."""
        with self.db.read(snapshot=True) as conn:
            return conn.execute(
                "SELECT COALESCE(SUM(size), 0) FROM blobs WHERE hash IN"
                " (SELECT eb.hash FROM entry_blobs eb JOIN entries e ON e.id = eb.entry_id WHERE e.trashed_at IS NOT NULL)"
                " AND hash NOT IN (SELECT eb.hash FROM entry_blobs eb JOIN entries e ON e.id = eb.entry_id WHERE e.trashed_at IS NULL)"
                " AND hash NOT IN (SELECT hash FROM record_blobs) AND hash NOT IN (SELECT hash FROM job_blobs)"
            ).fetchone()[0]
