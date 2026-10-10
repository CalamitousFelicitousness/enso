import os
import sqlite3
import threading

import pytest

from enso_api.sqlite import Database, NewerDatabase

ITEMS = "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);"


def open_db(root, migrations=None, **kwargs) -> Database:
    return Database(os.path.join(root, "test.db"), [(1, ITEMS)] if migrations is None else migrations, label="Test", **kwargs)


def raw(root) -> sqlite3.Connection:
    return sqlite3.connect(os.path.join(root, "test.db"))


def insert(db: Database, name: str) -> None:
    with db.write() as w:
        w.conn.execute("INSERT INTO items (name) VALUES (?)", (name,))


def count(db: Database) -> int:
    with db.read() as conn:
        return conn.execute("SELECT COUNT(*) FROM items").fetchone()[0]


def in_thread(fn, timeout: float = 10.0):
    """fn's result from another thread; a hang fails the test instead of the run."""
    box = {}

    def run():
        try:
            box["value"] = fn()
        except BaseException as e:
            box["error"] = e

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    thread.join(timeout)
    assert not thread.is_alive(), "timed out"
    if "error" in box:
        raise box["error"]
    return box.get("value")


def test_migrations_apply_once_and_in_order(root):
    calls = []

    def add_size(conn):
        calls.append(2)
        conn.execute("ALTER TABLE items ADD COLUMN size INTEGER NOT NULL DEFAULT 0")

    migrations = [(2, add_size), (1, ITEMS)]
    open_db(root, migrations).close()
    db = open_db(root, migrations)
    assert db.version == 2
    assert calls == [2]
    with db.read() as conn:
        assert [row["name"] for row in conn.execute("PRAGMA table_info(items)")] == ["id", "name", "size"]
    db.close()


def test_failed_script_leaves_no_table_and_the_version(root):
    broken = "CREATE TABLE first (id INTEGER);\nCREATE TABLE first (id INTEGER);"
    with pytest.raises(sqlite3.OperationalError):
        open_db(root, [(1, ITEMS), (2, broken)])
    conn = raw(root)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 1
    assert conn.execute("SELECT name FROM sqlite_master WHERE name = 'first'").fetchone() is None
    conn.close()


def test_failed_function_leaves_the_version(root):
    def broken(conn):
        conn.execute("CREATE TABLE first (id INTEGER)")
        raise ValueError("stop")

    with pytest.raises(ValueError):
        open_db(root, [(1, ITEMS), (2, broken)])
    conn = raw(root)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 1
    assert conn.execute("SELECT name FROM sqlite_master WHERE name = 'first'").fetchone() is None
    conn.close()


def test_newer_file_refuses_to_open(root):
    conn = raw(root)
    conn.execute("PRAGMA user_version = 5")
    conn.close()
    with pytest.raises(NewerDatabase) as refused:
        open_db(root)
    assert (refused.value.found, refused.value.known) == (5, 1)


def test_unknown_synchronous_mode_is_refused(root):
    with pytest.raises(ValueError):
        open_db(root, synchronous="SOMETIMES")


def test_synchronous_mode_applies_to_the_writer(root):
    db = open_db(root, synchronous="NORMAL")
    with db.write() as w:
        assert w.conn.execute("PRAGMA synchronous").fetchone()[0] == 1
    db.close()


def test_write_rolls_back_on_an_exception(root):
    db = open_db(root)
    with pytest.raises(ValueError), db.write() as w:
        w.conn.execute("INSERT INTO items (name) VALUES ('a')")
        raise ValueError("stop")
    assert count(db) == 0
    insert(db, "b")
    assert count(db) == 1
    db.close()


def test_early_commit_lands_while_the_lock_is_held(root):
    db = open_db(root)
    with db.write() as w:
        w.conn.execute("INSERT INTO items (name) VALUES ('a')")
        w.commit()
        assert in_thread(lambda: count(db)) == 1
        assert db.lock.locked()
        w.conn.execute("INSERT INTO items (name) VALUES ('b')")
    assert count(db) == 2
    assert not db.lock.locked()
    db.close()


def test_reader_on_another_thread_sees_the_state_before_the_write(root):
    db = open_db(root)
    with db.write() as w:
        w.conn.execute("INSERT INTO items (name) VALUES ('a')")
        assert in_thread(lambda: count(db)) == 0
        # this thread reads through the writer, so it sees its own write
        assert count(db) == 1
    assert in_thread(lambda: count(db)) == 1
    db.close()


def test_snapshot_read_sees_one_state(root):
    db = open_db(root)
    with db.read(snapshot=True) as conn:
        before = conn.execute("SELECT COUNT(*) FROM items").fetchone()[0]
        in_thread(lambda: insert(db, "a"))
        after = conn.execute("SELECT COUNT(*) FROM items").fetchone()[0]
    assert before == after == 0
    assert count(db) == 1
    db.close()


def test_nested_write_on_one_thread_raises(root):
    db = open_db(root)
    with db.write(), pytest.raises(RuntimeError), db.write():
        pass
    db.close()


def test_backup_runs_beside_an_open_write(root):
    db = open_db(root)
    insert(db, "kept")
    dest = os.path.join(root, "copy.db")
    with db.write() as w:
        w.conn.execute("INSERT INTO items (name) VALUES ('pending')")
        size = in_thread(lambda: db.backup(dest))
    assert size == os.path.getsize(dest)
    copy = sqlite3.connect(dest)
    assert [row[0] for row in copy.execute("SELECT name FROM items")] == ["kept"]
    copy.close()
    db.close()


def test_connections_enforce_foreign_keys(root):
    schema = "CREATE TABLE parent (id INTEGER PRIMARY KEY);\nCREATE TABLE child (parent INTEGER NOT NULL REFERENCES parent(id));"
    db = open_db(root, [(1, schema)])
    with pytest.raises(sqlite3.IntegrityError), db.write() as w:
        w.conn.execute("INSERT INTO child (parent) VALUES (1)")
    assert in_thread(lambda: db.reader().execute("PRAGMA foreign_keys").fetchone()[0]) == 1
    db.close()


def test_close_reaches_readers_of_other_threads(root):
    db = open_db(root)
    conn = in_thread(db.reader)
    db.close()
    with pytest.raises(sqlite3.ProgrammingError):
        conn.execute("SELECT 1")
