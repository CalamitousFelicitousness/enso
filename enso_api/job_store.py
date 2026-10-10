from __future__ import annotations

import contextlib
import json
import os
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from enso_api.sqlite import Database

if TYPE_CHECKING:
    import sqlite3
    from collections.abc import Sequence

TERMINAL = ("completed", "failed", "cancelled")

SCHEMA_V1 = """
CREATE TABLE IF NOT EXISTS jobs (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    priority     INTEGER NOT NULL DEFAULT 0,
    params       TEXT NOT NULL,
    result       TEXT,
    error        TEXT,
    progress     REAL NOT NULL DEFAULT 0,
    step         INTEGER NOT NULL DEFAULT 0,
    steps        INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    started_at   TEXT,
    completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);
CREATE TABLE IF NOT EXISTS outputs (
    id         TEXT PRIMARY KEY,
    path       TEXT NOT NULL,
    job_id     TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outputs_path ON outputs(path);
"""

# Version 1 is the schema every earlier build created, so an existing file is stamped without a change
MIGRATIONS = [(1, SCHEMA_V1)]


class JobStore:
    def __init__(self, db_path: str):
        self.db_path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self.db = Database(db_path, MIGRATIONS, label="Job queue")

    @staticmethod
    def now() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict:
        d = dict(row)
        if d.get("result") and isinstance(d["result"], str):
            with contextlib.suppress(json.JSONDecodeError, TypeError):
                d["result"] = json.loads(d["result"])
        return d

    @staticmethod
    def _cleanup_staging(results: list) -> None:
        for result_raw in results:
            try:
                result = json.loads(result_raw) if isinstance(result_raw, str) else result_raw
                if isinstance(result, dict):
                    staging_dir = result.get("_staging_dir")
                    if staging_dir and os.path.isdir(staging_dir):
                        shutil.rmtree(staging_dir, ignore_errors=True)
            except (json.JSONDecodeError, TypeError, OSError):
                pass

    @staticmethod
    def new_id() -> str:
        return uuid.uuid4().hex[:16]

    def insert(self, job_type: str, params: dict, priority: int = 0, job_id: str | None = None) -> dict:
        """Add a pending job; the row as written, built without a read after the commit."""
        job = {
            "id": job_id or self.new_id(),
            "type": job_type,
            "status": "pending",
            "priority": priority,
            "params": json.dumps(params, default=str),
            "result": None,
            "error": None,
            "progress": 0.0,
            "step": 0,
            "steps": 0,
            "created_at": self.now(),
            "started_at": None,
            "completed_at": None,
        }
        with self.db.write() as w:
            w.conn.execute(
                "INSERT INTO jobs (id, type, status, priority, params, created_at) VALUES (?, ?, 'pending', ?, ?, ?)",
                (job["id"], job_type, priority, job["params"], job["created_at"]),
            )
        return job

    def get(self, job_id: str) -> dict | None:
        with self.db.read() as conn:
            row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return self._row_to_dict(row) if row else None

    def list(self, status: str | None = None, job_type: str | None = None, before: str | None = None, after: str | None = None, limit: int = 20, offset: int = 0) -> tuple[list[dict], int]:
        where_parts: list[str] = []
        binds: list = []
        if status:
            where_parts.append("status = ?")
            binds.append(status)
        if job_type:
            where_parts.append("type = ?")
            binds.append(job_type)
        if before:
            where_parts.append("created_at < ?")
            binds.append(before)
        if after:
            where_parts.append("created_at >= ?")
            binds.append(after)
        where_clause = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        with self.db.read(snapshot=True) as conn:
            total = conn.execute(f"SELECT COUNT(*) FROM jobs {where_clause}", binds).fetchone()[0]
            rows = conn.execute(f"SELECT * FROM jobs {where_clause} ORDER BY created_at DESC LIMIT ? OFFSET ?", [*binds, limit, offset]).fetchall()
        return [self._row_to_dict(r) for r in rows], total

    def live_ids(self) -> set[str]:
        """Every pending and running job."""
        with self.db.read() as conn:
            return {row[0] for row in conn.execute("SELECT id FROM jobs WHERE status IN ('pending', 'running')")}

    def update_status(self, job_id: str, status: str, current: Sequence[str] | None = None, **kwargs) -> bool:
        """Set a job's status and the given columns, with `current` only while its status is one of those; whether the row changed."""
        sets = ["status = ?"]
        binds: list = [status]
        for key in ("started_at", "completed_at", "error"):
            if key in kwargs:
                sets.append(f"{key} = ?")
                binds.append(kwargs[key])
        if "result" in kwargs:
            sets.append("result = ?")
            val = kwargs["result"]
            binds.append(json.dumps(val, default=str) if not isinstance(val, str) else val)
        where = "id = ?"
        binds.append(job_id)
        if current:
            where += f" AND status IN ({','.join('?' for _ in current)})"
            binds.extend(current)
        with self.db.write() as w:
            return w.conn.execute(f"UPDATE jobs SET {', '.join(sets)} WHERE {where}", binds).rowcount > 0

    def set_priority(self, job_id: str, priority: int) -> bool:
        """Change a queued job's priority; False once it has left the queue."""
        with self.db.write() as w:
            return w.conn.execute("UPDATE jobs SET priority = ? WHERE id = ? AND status = 'pending'", (priority, job_id)).rowcount > 0

    def update_progress(self, job_id: str, progress: float, step: int, steps: int) -> None:
        with self.db.write() as w:
            w.conn.execute("UPDATE jobs SET progress = ?, step = ?, steps = ? WHERE id = ?", (progress, step, steps, job_id))

    def cancel(self, job_id: str) -> bool:
        with self.db.write() as w:
            return w.conn.execute("UPDATE jobs SET status = 'cancelled', completed_at = ? WHERE id = ? AND status IN ('pending', 'running')", (self.now(), job_id)).rowcount > 0

    def delete(self, job_id: str) -> bool:
        with self.db.write() as w:
            row = w.conn.execute("SELECT result FROM jobs WHERE id = ? AND status IN ('completed', 'failed', 'cancelled')", (job_id,)).fetchone()
            if row is None:
                return False
            w.conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        self._cleanup_staging([row[0]])
        return True

    def purge(self) -> int:
        return self.delete_where("status IN ('completed', 'failed', 'cancelled')", [])

    def delete_where(self, where: str, binds: list) -> int:
        """Delete the rows matching where and their staging folders; the count deleted."""
        with self.db.write() as w:
            results = [row[0] for row in w.conn.execute(f"SELECT result FROM jobs WHERE {where}", binds)]
            deleted = w.conn.execute(f"DELETE FROM jobs WHERE {where}", binds).rowcount
        self._cleanup_staging(results)
        return deleted

    def bulk_cancel(self, job_type: str | None = None, ids: list[str] | None = None, before: str | None = None, after: str | None = None) -> int:
        where_parts = ["status = 'pending'"]
        binds: list = []
        if job_type:
            where_parts.append("type = ?")
            binds.append(job_type)
        if ids:
            placeholders = ",".join("?" for _ in ids)
            where_parts.append(f"id IN ({placeholders})")
            binds.extend(ids)
        if before:
            where_parts.append("created_at < ?")
            binds.append(before)
        if after:
            where_parts.append("created_at >= ?")
            binds.append(after)
        where_clause = f"WHERE {' AND '.join(where_parts)}"
        with self.db.write() as w:
            return w.conn.execute(f"UPDATE jobs SET status = 'cancelled', completed_at = ? {where_clause}", [self.now(), *binds]).rowcount

    def bulk_delete(self, status: str | None = None, job_type: str | None = None, ids: list[str] | None = None, before: str | None = None, after: str | None = None) -> int:
        where_parts = [f"status IN ({','.join('?' for _ in TERMINAL)})"]
        binds: list = list(TERMINAL)
        if status:
            where_parts.append("status = ?")
            binds.append(status)
        if job_type:
            where_parts.append("type = ?")
            binds.append(job_type)
        if ids:
            placeholders = ",".join("?" for _ in ids)
            where_parts.append(f"id IN ({placeholders})")
            binds.extend(ids)
        if before:
            where_parts.append("created_at < ?")
            binds.append(before)
        if after:
            where_parts.append("created_at >= ?")
            binds.append(after)
        return self.delete_where(" AND ".join(where_parts), binds)

    def stats(self) -> dict:
        with self.db.read(snapshot=True) as conn:
            counts = {row[0]: row[1] for row in conn.execute("SELECT status, COUNT(*) FROM jobs GROUP BY status")}
            outputs_total = conn.execute("SELECT COUNT(*) FROM outputs").fetchone()[0]
        total = sum(counts.values())
        staging_bytes = 0
        from enso_api.temp_store import get_staging_dir

        staging_dir = get_staging_dir()
        if staging_dir and os.path.isdir(staging_dir):
            for dirpath, _dirnames, filenames in os.walk(staging_dir):
                for f in filenames:
                    with contextlib.suppress(OSError):
                        staging_bytes += os.path.getsize(os.path.join(dirpath, f))
        return {"total": total, "counts": counts, "staging_bytes": staging_bytes, "outputs_total": outputs_total}

    def register_output(self, path: str, job_id: str | None = None) -> str:
        """Mint a durable id addressing `path`.

        A fresh id per call, deliberately without UNIQUE(path): the filename
        sequencer can hand out a previously deleted path again after a
        restart, and returning the old id would silently point stored
        history at the new image. Rows are never swept; a row whose file is
        gone serves an honest 404.
        """
        output_id = uuid.uuid4().hex[:16]
        with self.db.write() as w:
            w.conn.execute("INSERT INTO outputs (id, path, job_id, created_at) VALUES (?, ?, ?, ?)", (output_id, path, job_id, self.now()))
        return output_id

    def resolve_output(self, output_id: str) -> dict | None:
        with self.db.read() as conn:
            row = conn.execute("SELECT * FROM outputs WHERE id = ?", (output_id,)).fetchone()
        return dict(row) if row else None

    def outputs_count(self) -> int:
        with self.db.read() as conn:
            return conn.execute("SELECT COUNT(*) FROM outputs").fetchone()[0]

    def cleanup(self, max_age_hours: int = 168) -> int:
        # The cutoff must be in the same shape now() stores: SQLite's
        # datetime() renders a space-separated string with no offset, which
        # compares below the stored T-separated form on the separator byte,
        # so rows only aged out on a later calendar date.
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=max_age_hours)).isoformat()
        return self.delete_where("status IN ('completed', 'failed', 'cancelled') AND completed_at IS NOT NULL AND completed_at < ?", [cutoff])

    def next_pending(self) -> dict | None:
        with self.db.read() as conn:
            row = conn.execute("SELECT * FROM jobs WHERE status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT 1").fetchone()
        return self._row_to_dict(row) if row else None

    def close(self):
        self.db.close()
