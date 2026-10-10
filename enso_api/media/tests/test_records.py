import os

import pytest

from enso_api.media.entries import Gone, Refused
from enso_api.media.records import RecordIn, Records
from enso_api.media.schema import MIGRATIONS
from enso_api.media.tests.helpers import link_record, png, put
from enso_api.sqlite import Database

LEGACY = "0123456789abcdef"
SUBMIT = "f" * 32


@pytest.fixture
def records(store, db, clock):
    return Records(db, store.held, store.resolve_ref, store.settings, clock)


class Queue:
    """Stands in for the job queue: enqueue writes a row, lookup reads it."""

    def __init__(self, fail: str | None = None):
        self.rows: dict[str, dict] = {}
        self.fail = fail
        self.calls = 0

    def enqueue(self, job_id: str) -> dict:
        self.calls += 1
        if self.fail == "before":
            raise RuntimeError("insert failed")
        self.rows[job_id] = {"id": job_id, "status": "pending"}
        if self.fail == "after":
            raise RuntimeError("failed after the insert")
        return self.rows[job_id]

    def lookup(self, job_id: str) -> dict | None:
        return self.rows.get(job_id)


def record(hashes: dict[str, str], client: str = "c1", unavailable=(), inputs=True) -> RecordIn:
    frames = {"frames": [{"pictures": [{"cid": cid} for cid in [*hashes, *unavailable]]}]} if inputs else None
    return RecordIn(client, {"title": "model"}, {}, frames, [], {}, hashes, list(unavailable))


def blobs(store, *seeds):
    return [put(store, png(seed))[0].hash for seed in seeds]


def rows(store, table: str, job_id: str) -> set:
    column = "hash" if table != "records" else "job_id"
    with store.db.read() as conn:
        return {row[0] for row in conn.execute(f"SELECT {column} FROM {table} WHERE job_id = ?", (job_id,))}


def submit(records, queue, request, rec, job_id="j1", submit_id=SUBMIT, domain="generate"):
    return records.submit_with_record(job_id, submit_id, rec, request, domain, "alice", queue.enqueue, queue.lookup)


def test_a_submit_names_the_job_and_writes_its_record(records, store):
    picture, ref = blobs(store, 1, 2)
    queue = Queue()
    done = submit(records, queue, {"type": "generate", "init_images": [f"upload:{ref}"]}, record({"p": picture}))
    assert done.created and done.job == {"id": "j1", "status": "pending"}
    assert rows(store, "job_blobs", "j1") == {ref}
    assert rows(store, "record_blobs", "j1") == {picture, ref}
    item = records.list(ids=["j1"])[0]
    assert (item["routed"], item["has_inputs"], item["missing_refs"], item["user"]) == (False, True, 0, "alice")


def test_a_submit_of_a_domain_off_the_strip_is_routed_at_once(records, store):
    queue = Queue()
    submit(records, queue, {"type": "upscale"}, record({}, inputs=False), domain="upscale")
    assert records.list(ids=["j1"])[0]["routed"] is True


def test_a_missing_hash_or_an_unresolvable_job_ref_writes_nothing(records, store):
    (picture,) = blobs(store, 1)
    queue = Queue()
    with pytest.raises(Refused) as refused:
        submit(records, queue, {"init_images": [f"upload:{LEGACY}", f"upload:{'e' * 64}"]}, record({"p": picture, "q": "d" * 64}))
    assert sorted(issue["loc"][1] for issue in refused.value.issues) == ["job", "job", "record"]
    assert queue.calls == 0
    assert records.list(ids=["j1"]) == []
    assert rows(store, "job_blobs", "j1") == set()


def test_a_failed_insert_discards_the_record_and_the_names(records, store):
    (ref,) = blobs(store, 1)
    queue = Queue(fail="before")
    with pytest.raises(RuntimeError):
        submit(records, queue, {"init_images": [f"upload:{ref}"]}, record({}))
    assert records.list(ids=["j1"]) == []
    assert rows(store, "job_blobs", "j1") == set()
    assert rows(store, "record_blobs", "j1") == set()


def test_a_failure_after_the_insert_keeps_the_record(records, store):
    queue = Queue(fail="after")
    with pytest.raises(RuntimeError):
        submit(records, queue, {}, record({}))
    assert [item["job_id"] for item in records.list(ids=["j1"])] == ["j1"]


def test_a_repeated_submit_id_answers_the_job_it_queued(records, store):
    queue = Queue()
    submit(records, queue, {}, record({}))
    again = submit(records, queue, {}, record({}), job_id="j2")
    assert (again.created, again.job["id"], queue.calls) == (False, "j1", 1)
    queue.rows.clear()
    with pytest.raises(Refused) as refused:
        submit(records, queue, {}, record({}), job_id="j3")
    assert refused.value.code == "already_submitted"


def test_discard_leaves_no_row_link_or_name(records, store):
    picture, ref = blobs(store, 1, 2)
    submit(records, Queue(), {"x": f"upload:{ref}"}, record({"p": picture}))
    records.discard("j1")
    assert records.list(ids=["j1"]) == []
    assert rows(store, "job_blobs", "j1") == set() and rows(store, "record_blobs", "j1") == set()
    assert store.row(picture).unnamed_since is not None


def test_a_put_counts_unheld_refs_of_any_shape_and_names_held_ones(records, store):
    picture, ref = blobs(store, 1, 2)
    request = {"a": f"upload:{ref}", "b": f"upload:{LEGACY}", "c": f"upload:{'e' * 64}"}
    item, created = records.put("old", record({"p": picture}, unavailable=["gone"]), request, "generate", 7, True, None)
    assert created
    assert (item["missing_refs"], item["unavailable"], item["has_inputs"], item["created_at"]) == (2, 1, True, 7)
    assert rows(store, "record_blobs", "old") == {picture, ref}
    again, created = records.put("old", record({}), {}, "generate", 9, False, None)
    assert not created and again["created_at"] == 7


def test_a_put_at_the_clients_cap_is_refused(records, store):
    store.update_settings({"record_cap": 50})
    for i in range(50):
        link_record(store, f"r{i}", [], client="c1")
    with pytest.raises(Refused) as refused:
        records.put("one-more", record({}), {}, "generate", 1, True, None)
    assert (refused.value.code, refused.value.fields) == ("records_full", {"cap": 50, "count": 50})
    records.put("other", record({}, client="c2"), {}, "generate", 1, True, None)


def test_the_list_filters_and_counts_what_is_lost(records, store, clock):
    picture, ref = blobs(store, 1, 2)
    records.put("a", record({"p": picture}), {"x": f"upload:{ref}"}, "generate", 1, False, None)
    records.put("b", record({}, client="c2"), {}, "generate", 2, True, None)
    with store.db.write() as w:
        w.conn.execute("UPDATE blobs SET lost_at = ?", (clock(),))
    assert [item["job_id"] for item in records.list(client="c1", routed=False)] == ["a"]
    assert [item["job_id"] for item in records.list(ids=["a", "b"])] == ["b", "a"]
    item = records.list(ids=["a"])[0]
    assert (item["missing_refs"], item["lost"]) == (1, 1)
    with pytest.raises(ValueError):
        records.list()


def test_get_names_the_lost_cids_and_the_refs_that_cannot_go_again(records, store):
    picture, ref = blobs(store, 1, 2)
    records.put("a", record({"p": picture}), {"x": f"upload:{ref}", "y": f"upload:{LEGACY}"}, "generate", 1, True, None)
    os.remove(store.path(store.row(ref)))
    with store.db.write() as w:
        w.conn.execute("UPDATE blobs SET lost_at = 1 WHERE hash = ?", (picture,))
    full = records.get("a")
    assert full["lost_cids"] == ["p"]
    assert full["missing_ref_ids"] == sorted([ref, LEGACY])
    assert full["unavailable_cids"] == [] and full["unavailable"] == 0
    assert records.get("nope") is None


def test_route_marks_once_and_refuses_an_unknown_job(records, store):
    records.put("a", record({}), {}, "generate", 1, False, None)
    assert records.route("a")["routed"] is True
    assert records.route("a")["routed"] is True
    with pytest.raises(Gone):
        records.route("nope")


def test_migration_2_upgrades_a_version_1_file(root):
    path = os.path.join(root, "old.db")
    first = Database(path, MIGRATIONS[:1], label="Media store")
    with first.write() as w:
        w.conn.execute("INSERT INTO records (job_id, client, domain, created_at, document) VALUES ('j', 'c', 'generate', 1, '{}')")
        w.conn.execute("INSERT INTO entries (id, kind, name, saved_at, used_at, frames, pictures, width, height, schema, document) VALUES ('e', 'frame', 'e', 0, 0, 1, 1, 8, 8, 1, '{}')")
    first.close()
    second = Database(path, MIGRATIONS, label="Media store")
    assert second.version == 2
    with second.read() as conn:
        assert tuple(conn.execute("SELECT has_inputs, unheld_refs, unavailable, ref_hashes, submit_id FROM records").fetchone()) == (0, 0, 0, "[]", None)
        assert conn.execute("SELECT thumbs FROM entries").fetchone()[0] == "[]"
    second.close()


def test_a_durable_write_raises_synchronous_for_its_commit_only(db):
    statements: list[str] = []
    db.writer.set_trace_callback(statements.append)
    with db.write(durable=True) as w:
        w.conn.execute("INSERT INTO meta (key, value) VALUES ('k', 'v')")
    with db.write():
        pass
    db.writer.set_trace_callback(None)
    pragmas = [s for s in statements if s.startswith("PRAGMA synchronous")]
    assert pragmas == ["PRAGMA synchronous=FULL", "PRAGMA synchronous=NORMAL"]
    assert statements.index("PRAGMA synchronous=FULL") < statements.index("BEGIN IMMEDIATE") < statements.index("PRAGMA synchronous=NORMAL")
