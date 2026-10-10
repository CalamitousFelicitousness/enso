"""Job records in media.db: a job and its record in one call, the migration's puts, the lists and the routed mark.

A record names its pictures and maps by hash and the held refs of its request; a ref the store does not hold
is kept in the request and counted, never named.
"""

import json
import logging
import sqlite3
from collections import defaultdict
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from enso_api.documents import Checked, check_record, missing_issues, ref_issues, refs_in
from enso_api.domains import STRIP_DOMAINS
from enso_api.media.entries import Gone, Refused, lost_among, refused_issues
from enso_api.media.settings import Settings
from enso_api.media.store import chunks, marks
from enso_api.sqlite import Database

log = logging.getLogger("sd")


@dataclass(frozen=True)
class RecordIn:
    client: str
    checkpoint: Any
    refs: dict
    inputs: Any
    map_keys: list[str]
    maps: dict[str, str]
    hashes: dict[str, str]
    unavailable: list[str]


@dataclass(frozen=True)
class Submitted:
    job: dict
    created: bool


def record_items(conn: sqlite3.Connection, rows: Sequence[sqlite3.Row]) -> list[dict]:
    lost: dict[str, set[str]] = defaultdict(set)
    for part in chunks([row["job_id"] for row in rows]):
        query = f"SELECT rb.job_id, rb.hash FROM record_blobs rb JOIN blobs b ON b.hash = rb.hash WHERE b.lost_at IS NOT NULL AND rb.job_id IN ({marks(len(part))})"
        for job_id, digest in conn.execute(query, part):
            lost[job_id].add(digest)
    found = []
    for row in rows:
        refs = set(json.loads(row["ref_hashes"]))
        gone = lost.get(row["job_id"], set())
        found.append(
            {
                "job_id": row["job_id"],
                "client": row["client"],
                "user": row["user"],
                "domain": row["domain"],
                "created_at": row["created_at"],
                "routed": bool(row["routed"]),
                "has_inputs": bool(row["has_inputs"]),
                "missing_refs": row["unheld_refs"] + len(gone & refs),
                "lost": len(gone - refs),
                "unavailable": row["unavailable"],
            }
        )
    return found


class Records:
    def __init__(
        self,
        db: Database,
        held: Callable[[Iterable[str]], set[str]],
        resolve: Callable[[str], str | None],
        settings: Callable[[], Settings],
        now: Callable[[], int],
    ):
        self.db = db
        self.held = held
        self.resolve = resolve
        self.settings = settings
        self.now = now

    def insert(self, conn: sqlite3.Connection, job_id: str, record: RecordIn, request: dict, domain: str, created_at: int, routed: bool, user: str | None, checked: Checked, unheld: int, ref_hashes: set[str], submit_id: str | None) -> None:
        document = {
            "checkpoint": record.checkpoint,
            "request": request,
            "refs": record.refs,
            "inputs": record.inputs,
            "map_keys": record.map_keys,
            "maps": record.maps,
            "hashes": checked.hashes,
            "unavailable": list(checked.unavailable),
        }
        conn.execute(
            "INSERT INTO records (job_id, client, user, domain, created_at, routed, document, has_inputs, unheld_refs, unavailable, ref_hashes, submit_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (job_id, record.client, user, domain, created_at, int(routed), json.dumps(document), int(record.inputs is not None), unheld, len(checked.unavailable), json.dumps(sorted(ref_hashes)), submit_id),
        )
        conn.executemany("INSERT INTO record_blobs (job_id, hash) VALUES (?, ?)", [(job_id, digest) for digest in sorted(checked.names | ref_hashes)])

    def submitted(self, submit_id: str) -> str | None:
        with self.db.read() as conn:
            found = conn.execute("SELECT job_id FROM records WHERE submit_id = ?", (submit_id,)).fetchone()
        return found[0] if found else None

    @staticmethod
    def resubmitted(job_id: str, lookup: Callable[[str], dict | None]) -> Submitted:
        job = lookup(job_id)
        if job is None:
            raise Refused(409, "already_submitted", "This submission was queued before and its job is gone", job_id=job_id)
        return Submitted(job, False)

    def submit_with_record(
        self,
        job_id: str,
        submit_id: str,
        record: RecordIn,
        request: dict,
        domain: str,
        user: str | None,
        enqueue: Callable[[str], dict],
        lookup: Callable[[str], dict | None],
    ) -> Submitted:
        """The record and the job's names in one durable write, then the job's row, the one step after it that can fail.

        A repeated submit_id answers the job it queued. A failed insert discards the record only when no job row exists.
        """
        prior = self.submitted(submit_id)
        if prior is not None:
            return self.resubmitted(prior, lookup)
        checked = check_record(request, record.inputs, record.maps, record.hashes, record.unavailable, loc=("body", "record"), request_loc=("body", "job"))
        if checked.issues:
            raise refused_issues(list(checked.issues))
        resolved = {ref: self.resolve(ref) for ref in refs_in(request)}
        now = self.now()
        try:
            with self.db.write(durable=True) as w:
                held = self.held(checked.names | {digest for digest in resolved.values() if digest})
                unresolved = {ref for ref, digest in resolved.items() if digest is None or digest not in held}
                missing = checked.names - held
                if unresolved or missing:
                    raise refused_issues(ref_issues(request, unresolved, ("body", "job")) + missing_issues(missing, checked.locations))
                job_hashes = {digest for digest in resolved.values() if digest}
                w.conn.executemany("INSERT OR IGNORE INTO job_blobs (job_id, hash, named_at) VALUES (?, ?, ?)", [(job_id, digest, now) for digest in sorted(job_hashes)])
                self.insert(w.conn, job_id, record, request, domain, now, domain not in STRIP_DOMAINS, user, checked, 0, job_hashes, submit_id)
        except sqlite3.IntegrityError:
            prior = self.submitted(submit_id)
            if prior is None:
                raise
            return self.resubmitted(prior, lookup)
        try:
            job = enqueue(job_id)
        except BaseException:
            self.discard_unless_queued(job_id, lookup)
            raise
        return Submitted(job, True)

    def discard_unless_queued(self, job_id: str, lookup: Callable[[str], dict | None]) -> None:
        try:
            if lookup(job_id) is None:
                self.discard(job_id)
        except Exception as e:
            # The collector drops the names once the job is not live; the record goes with the caps
            log.error(f"Records: record of id={job_id} not discarded: {type(e).__name__}: {e}")

    def discard(self, job_id: str) -> None:
        """The record, its links and the job's names, in one write."""
        with self.db.write(durable=True) as w:
            w.conn.execute("DELETE FROM records WHERE job_id = ?", (job_id,))
            w.conn.execute("DELETE FROM job_blobs WHERE job_id = ?", (job_id,))

    def put(self, job_id: str, record: RecordIn, request: dict, domain: str, created_at: int, routed: bool, user: str | None) -> tuple[dict, bool]:
        """Store the record of a job that already ran; a row already stored answers as it is."""
        existing = self.list(ids=[job_id])
        if existing:
            return existing[0], False
        checked = check_record(request, record.inputs, record.maps, record.hashes, record.unavailable)
        if checked.issues:
            raise refused_issues(list(checked.issues))
        resolved = {ref: self.resolve(ref) for ref in refs_in(request)}
        cap = self.settings().record_cap
        with self.db.write(durable=True) as w:
            rows = w.conn.execute("SELECT * FROM records WHERE job_id = ?", (job_id,)).fetchall()
            if rows:
                return record_items(w.conn, rows)[0], False
            count = w.conn.execute("SELECT COUNT(*) FROM records WHERE client = ?", (record.client,)).fetchone()[0]
            if count >= cap:
                raise Refused(409, "records_full", f"This browser has {count} of {cap} job records", cap=cap, count=count)
            held = self.held(checked.names | {digest for digest in resolved.values() if digest})
            missing = checked.names - held
            if missing:
                raise refused_issues(missing_issues(missing, checked.locations))
            unheld = sum(1 for digest in resolved.values() if digest is None or digest not in held)
            ref_hashes = {digest for digest in resolved.values() if digest in held}
            self.insert(w.conn, job_id, record, request, domain, created_at, routed, user, checked, unheld, ref_hashes, None)
            item = record_items(w.conn, w.conn.execute("SELECT * FROM records WHERE job_id = ?", (job_id,)).fetchall())[0]
        return item, True

    def list(self, client: str | None = None, routed: bool | None = None, ids: Sequence[str] | None = None) -> list[dict]:
        """Records by client, routed mark or job ids, newest first."""
        where: list[str] = []
        binds: list = []
        if client is not None:
            where.append("client = ?")
            binds.append(client)
        if routed is not None:
            where.append("routed = ?")
            binds.append(int(routed))
        if ids is not None:
            where.append(f"job_id IN ({marks(len(ids))})" if ids else "0")
            binds.extend(ids)
        if not where:
            raise ValueError("records are listed by client or by ids")
        with self.db.read(snapshot=True) as conn:
            rows = conn.execute(f"SELECT * FROM records WHERE {' AND '.join(where)} ORDER BY created_at DESC, job_id", binds).fetchall()
            return record_items(conn, rows)

    def get(self, job_id: str) -> dict | None:
        """The record with its document, the cids whose bytes are lost and the refs it cannot send again as they are."""
        with self.db.read(snapshot=True) as conn:
            rows = conn.execute("SELECT * FROM records WHERE job_id = ?", (job_id,)).fetchall()
            if not rows:
                return None
            item = record_items(conn, rows)[0]
            document = json.loads(rows[0]["document"])
            lost = lost_among(conn, document["hashes"].values())
        resolved = {ref: self.resolve(ref) for ref in refs_in(document["request"])}
        held = self.held(digest for digest in resolved.values() if digest)
        return {
            **item,
            "checkpoint": document["checkpoint"],
            "request": document["request"],
            "refs": document["refs"],
            "inputs": document["inputs"],
            "map_keys": document["map_keys"],
            "maps": document["maps"],
            "hashes": document["hashes"],
            "unavailable_cids": document["unavailable"],
            "lost_cids": sorted(cid for cid, digest in document["hashes"].items() if digest in lost),
            "missing_ref_ids": sorted(ref for ref, digest in resolved.items() if digest is None or digest not in held),
        }

    def route(self, job_id: str) -> dict:
        """Mark a record routed: its result reached a strip, or never will."""
        with self.db.write(durable=True) as w:
            if not w.conn.execute("UPDATE records SET routed = 1 WHERE job_id = ?", (job_id,)).rowcount:
                raise Gone(job_id)
            return record_items(w.conn, w.conn.execute("SELECT * FROM records WHERE job_id = ?", (job_id,)).fetchall())[0]
