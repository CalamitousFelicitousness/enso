import os
import sqlite3

import pytest

from enso_api.media.schema import MIGRATIONS
from enso_api.media.tests.helpers import link_entry, link_record, png, put
from enso_api.sqlite import Database


def unnamed(store, digest):
    return store.row(digest).unnamed_since


def test_links_clear_and_set_unnamed_since_in_each_table(store):
    row, _ = put(store, png(1))
    assert unnamed(store, row.hash) is not None
    link_entry(store, "e1", [row.hash])
    assert unnamed(store, row.hash) is None
    link_record(store, "r1", [row.hash])
    store.name_job("j1", [row.hash])
    with store.db.write() as w:
        w.conn.execute("DELETE FROM entry_blobs WHERE entry_id = 'e1'")
    assert unnamed(store, row.hash) is None
    with store.db.write() as w:
        w.conn.execute("DELETE FROM record_blobs WHERE job_id = 'r1'")
    assert unnamed(store, row.hash) is None
    store.release_job("j1")
    assert unnamed(store, row.hash) is not None


@pytest.mark.parametrize(("table", "key"), [("entries", "id"), ("records", "job_id")])
def test_a_cascade_fires_the_trigger(store, table, key):
    row, _ = put(store, png(1))
    link_entry(store, "e1", [row.hash])
    link_record(store, "e1", [row.hash])
    with store.db.write() as w:
        w.conn.execute(f"DELETE FROM {table} WHERE {key} = 'e1'")
    assert unnamed(store, row.hash) is None
    other = "records" if table == "entries" else "entries"
    other_key = "job_id" if table == "entries" else "id"
    with store.db.write() as w:
        w.conn.execute(f"DELETE FROM {other} WHERE {other_key} = 'e1'")
    assert unnamed(store, row.hash) is not None


def test_a_named_blob_cannot_be_deleted(store):
    named, _ = put(store, png(1))
    free, _ = put(store, png(2))
    link_entry(store, "e1", [named.hash])
    with pytest.raises(sqlite3.IntegrityError), store.db.write() as w:
        w.conn.execute("DELETE FROM blobs WHERE hash = ?", (named.hash,))
    with pytest.raises(sqlite3.IntegrityError), store.db.write() as w:
        w.conn.execute("DELETE FROM blobs WHERE hash IN (?, ?)", (free.hash, named.hash))
    assert store.row(free.hash) is not None
    assert store.row(named.hash) is not None


def test_an_entry_cannot_name_an_unknown_hash(store):
    with pytest.raises(sqlite3.IntegrityError):
        link_entry(store, "e1", ["e" * 64])


def test_the_upsert_keeps_unnamed_since(store, clock):
    row, _ = put(store, png(1))
    link_entry(store, "e1", [row.hash])
    clock.advance(1000)
    again, created = put(store, png(1))
    assert not created
    assert again.unnamed_since is None
    with store.db.write() as w:
        w.conn.execute("DELETE FROM entries WHERE id = 'e1'")
    since = unnamed(store, row.hash)
    clock.advance(1000)
    assert put(store, png(1))[0].unnamed_since == since


def test_migration_3_upgrades_a_version_2_file_and_a_trashed_file_takes_its_outputs_along(root):

    path = os.path.join(root, "old.db")
    first = Database(path, MIGRATIONS[:2], label="Media store")
    with first.write() as w:
        w.conn.execute("INSERT INTO entries (id, kind, name, saved_at, used_at, trashed_at, frames, pictures, width, height, schema, document) VALUES ('e', 'frame', 'e', 0, 0, 5, 1, 1, 8, 8, 1, '{}')")
    first.close()
    second = Database(path, MIGRATIONS[:3], label="Media store")
    assert second.version == 3
    with second.write() as w:
        assert w.conn.execute("SELECT clock_at FROM entries").fetchone()[0] is None
        w.conn.execute("INSERT INTO trashed_files (id, state, name, folder, kind, size, bytes, mtime, trashed_at) VALUES ('i', 'trashed', 'a.png', '/f', 'image', 1, 1, 0, 0)")
        w.conn.execute("INSERT INTO trashed_outputs (output_id, item_id, name) VALUES ('o', 'i', 'a.png')")
        w.conn.execute("DELETE FROM trashed_files WHERE id = 'i'")
        assert w.conn.execute("SELECT COUNT(*) FROM trashed_outputs").fetchone()[0] == 0
    second.close()
