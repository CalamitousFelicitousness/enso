"""One SQLite access pattern for the databases Enso owns.

Writes go through one connection under a lock held for the whole block; reads go through one connection
per thread, which WAL never makes wait on a write. The schema version is PRAGMA user_version: the
migrations above it run in order when the database opens, each in one transaction with its version stamp.
"""

import logging
import os
import sqlite3
import threading
import weakref
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager

log = logging.getLogger("sd")

# A script holds statements only; a function gets the writer connection inside the migration's transaction
Migration = tuple[int, str | Callable[[sqlite3.Connection], None]]

SYNCHRONOUS = ("OFF", "NORMAL", "FULL", "EXTRA")


class NewerDatabase(Exception):
    """The file's schema version is above every migration this build has."""

    def __init__(self, path: str, found: int, known: int):
        super().__init__(f"{path} is at schema version {found}, and this build knows versions up to {known}")
        self.path = path
        self.found = found
        self.known = known


class Connection(sqlite3.Connection):
    """A connection the registry can hold weakly, so a reader closes with its thread."""


class Writer:
    """The writer connection for one write block."""

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self.committed = False

    def commit(self) -> None:
        """End the transaction now; the lock stays held until the block ends, and later statements autocommit."""
        if not self.committed:
            self.conn.execute("COMMIT")
            self.committed = True


class Database:
    def __init__(self, path: str, migrations: Sequence[Migration], label: str, synchronous: str = "FULL"):
        if synchronous not in SYNCHRONOUS:
            raise ValueError(f"synchronous must be one of {', '.join(SYNCHRONOUS)}")
        self.path = path
        self.label = label
        self.synchronous = synchronous
        self.lock = threading.Lock()
        self.local = threading.local()
        self.connections: weakref.WeakSet[Connection] = weakref.WeakSet()
        self.connections_lock = threading.Lock()
        self.version = 0
        self.writer = self.connect()
        try:
            self.writer.execute("PRAGMA journal_mode=WAL")
            with self.lock:
                self.version = self.migrate(migrations)
        except BaseException:
            self.close()
            raise

    def connect(self) -> Connection:
        # check_same_thread off: the writer serves every thread under the lock, and close() reaches every reader
        conn = sqlite3.connect(self.path, isolation_level=None, check_same_thread=False, factory=Connection)
        conn.row_factory = sqlite3.Row
        # Per connection, and a no-op inside a transaction
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute(f"PRAGMA synchronous={self.synchronous}")
        with self.connections_lock:
            self.connections.add(conn)
        return conn

    def migrate(self, migrations: Sequence[Migration]) -> int:
        steps = sorted(migrations, key=lambda step: step[0])
        versions = [version for version, _ in steps]
        if len(set(versions)) != len(versions) or any(version < 1 for version in versions):
            raise ValueError(f"{self.label}: migration versions must be distinct and from 1")
        known = versions[-1] if versions else 0
        version = self.writer.execute("PRAGMA user_version").fetchone()[0]
        if version > known:
            raise NewerDatabase(self.path, version, known)
        for target, step in steps:
            if target <= version:
                continue
            try:
                if isinstance(step, str):
                    # executescript commits a pending transaction first and runs without one, so the script brings its own
                    self.writer.executescript(f"BEGIN IMMEDIATE;\n{step}\nPRAGMA user_version = {int(target)};\nCOMMIT;")
                else:
                    self.writer.execute("BEGIN IMMEDIATE")
                    step(self.writer)
                    self.writer.execute(f"PRAGMA user_version = {int(target)}")
                    self.writer.execute("COMMIT")
            except BaseException:
                if self.writer.in_transaction:
                    self.writer.execute("ROLLBACK")
                raise
            log.info(f"{self.label}: schema version {version} to {target} in {self.path}")
            version = target
        return version

    @contextmanager
    def write(self) -> Iterator[Writer]:
        """The lock and BEGIN IMMEDIATE; COMMIT at the end unless committed, ROLLBACK on an exception."""
        if getattr(self.local, "writer", None) is not None:
            raise RuntimeError(f"{self.label}: a write block is already open on this thread")
        with self.lock:
            writer = Writer(self.writer)
            self.writer.execute("BEGIN IMMEDIATE")
            self.local.writer = writer
            try:
                yield writer
                if not writer.committed:
                    writer.commit()
            except BaseException:
                if self.writer.in_transaction:
                    self.writer.execute("ROLLBACK")
                raise
            finally:
                self.local.writer = None

    @contextmanager
    def read(self, snapshot: bool = False) -> Iterator[sqlite3.Connection]:
        """This thread's connection, or the writer's inside this thread's write block; snapshot holds one read transaction."""
        writer = getattr(self.local, "writer", None)
        conn = writer.conn if writer is not None else self.reader()
        own = snapshot and not conn.in_transaction
        if own:
            conn.execute("BEGIN")
        try:
            yield conn
            if own:
                conn.execute("COMMIT")
        except BaseException:
            if own and conn.in_transaction:
                conn.execute("ROLLBACK")
            raise

    def reader(self) -> Connection:
        conn = getattr(self.local, "reader", None)
        if conn is None:
            conn = self.connect()
            self.local.reader = conn
        return conn

    def backup(self, dest: str) -> int:
        """Copy the committed state into dest from a fresh connection, without the lock; the bytes written.

        A source connection inside BEGIN IMMEDIATE makes the backup retry forever, so the writer is never the source.
        """
        source = self.connect()
        try:
            target = sqlite3.connect(dest)
            try:
                source.backup(target)
            finally:
                target.close()
        finally:
            source.close()
        return os.path.getsize(dest)

    def close(self) -> None:
        with self.connections_lock:
            connections = list(self.connections)
            self.connections = weakref.WeakSet()
        for conn in connections:
            conn.close()
