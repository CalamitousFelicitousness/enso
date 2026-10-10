import os
import time

import pytest

from enso_api import events
from enso_api.media.collector import (
    CLIENT_IDLE_MS,
    DAY_MS,
    DELETE_BATCH,
    GRACE_MS,
    HOUR_MS,
    PASS_MS,
    STRIP_RETENTION_MS,
    JobName,
    Part,
    RecordRow,
    Survey,
    TrashedEntry,
    apply,
    plan,
    survey,
)
from enso_api.media.settings import Settings
from enso_api.media.store import BlobRow
from enso_api.media.tests.helpers import link_entry, link_record, png, put

NOW = 1_760_000_000_000


def blob(h: str, unnamed: int | None, touched: int, transient: bool = False, lost: int | None = None) -> BlobRow:
    return BlobRow(h, "png", 10, "image/png", 0, touched, unnamed, transient, lost)


def base(**changes) -> Survey:
    values = {"now": NOW, "settings": Settings(), "live_jobs": frozenset(), "last_gc": NOW - PASS_MS}
    values.update(changes)
    return Survey(**values)


def test_drops_names_of_ended_jobs_older_than_a_pass():
    names = (JobName("ended", "a", NOW - 2 * PASS_MS), JobName("live", "b", NOW - 2 * PASS_MS), JobName("young", "c", NOW - 1000))
    assert plan(base(job_names=names, live_jobs=frozenset({"live"}))).drop_job_names == ("ended",)


def test_drops_no_name_before_the_queue_runs():
    names = (JobName("ended", "a", NOW - 2 * PASS_MS),)
    assert plan(base(job_names=names, live_jobs=None)).drop_job_names == ()


def test_a_newer_name_keeps_the_job():
    names = (JobName("job", "a", NOW - 2 * PASS_MS), JobName("job", "b", NOW - 1000))
    assert plan(base(job_names=names)).drop_job_names == ()


def test_expires_trashed_entries_by_the_days_given():
    trashed = (TrashedEntry("old", NOW - 8 * DAY_MS), TrashedEntry("new", NOW - 6 * DAY_MS))
    assert plan(base(trashed=trashed)).delete_entries == ("old",)
    assert plan(base(trashed=trashed, settings=Settings(trash_days=5))).delete_entries == ("new", "old")


def test_urgent_only_for_hashes_nothing_else_names():
    trashed = (TrashedEntry("old", NOW - 8 * DAY_MS), TrashedEntry("old2", NOW - 9 * DAY_MS))
    links = (("old", "a"), ("old", "b"), ("old2", "b"), ("old", "c"))
    counts = {"a": 1, "b": 2, "c": 2}
    assert plan(base(trashed=trashed, trashed_links=links, name_counts=counts)).urgent_blobs == ("a", "b")


def test_retires_records_per_client_past_the_cap_oldest_first():
    rows = [RecordRow(f"c1-{i:03d}", "c1", NOW - 30 * DAY_MS + i, True, "generate") for i in range(53)]
    rows += [RecordRow(f"c2-{i:03d}", "c2", NOW - 30 * DAY_MS + i, True, "generate") for i in range(50)]
    retired = plan(base(records=tuple(rows), settings=Settings(record_cap=50))).retire_records
    assert retired == ("c1-000", "c1-001", "c1-002")


def test_never_retires_a_live_or_young_unrouted_strip_record():
    old = NOW - 10 * DAY_MS
    rows = (
        RecordRow("live", "c1", old, True, "generate"),
        RecordRow("unrouted", "c1", NOW - STRIP_RETENTION_MS + HOUR_MS, False, "video"),
        RecordRow("unrouted-old", "c1", old + 1, False, "generate"),
        RecordRow("process", "c1", NOW - HOUR_MS, False, "process"),
        *(RecordRow(f"r{i}", "c1", NOW - i, True, "generate") for i in range(50)),
    )
    retired = plan(base(records=rows, live_jobs=frozenset({"live"}), settings=Settings(record_cap=50))).retire_records
    assert retired == ("unrouted-old", "process", "r49", "r48")


def test_retires_every_record_of_a_client_idle_past_the_bound_but_a_live_one():
    idle = NOW - CLIENT_IDLE_MS - DAY_MS
    rows = (
        RecordRow("gone-1", "gone", idle - 5, True, "generate"),
        RecordRow("gone-2", "gone", idle, False, "generate"),
        RecordRow("gone-live", "gone", idle - 9, True, "generate"),
        RecordRow("here-1", "here", idle, True, "generate"),
        RecordRow("here-2", "here", NOW - DAY_MS, True, "generate"),
    )
    assert plan(base(records=rows, live_jobs=frozenset({"gone-live"}))).retire_records == ("gone-1", "gone-2")


def test_grace_transient_grace_and_touch():
    candidates = (
        blob("past", NOW - GRACE_MS - 1, NOW - 2 * HOUR_MS),
        blob("inside", NOW - GRACE_MS + DAY_MS, NOW - 2 * HOUR_MS),
        blob("transient", NOW - 2 * HOUR_MS, NOW - 2 * HOUR_MS, transient=True),
        blob("touched", NOW - GRACE_MS - 1, NOW - 1000),
        blob("lost-named", None, NOW - GRACE_MS, lost=NOW),
    )
    assert plan(base(candidates=candidates)).delete_blobs == ("past", "transient")


def test_deletes_only_old_unregistered_parts():
    parts = (Part("/t/old.part", NOW - 2 * HOUR_MS, False), Part("/t/new.part", NOW - 1000, False), Part("/t/running.part", NOW - 5 * HOUR_MS, True))
    assert plan(base(parts=parts)).delete_parts == ("/t/old.part",)


@pytest.mark.parametrize("last_gc", [None, NOW - GRACE_MS - 1, NOW + 6 * 60 * 1000])
def test_rebases_on_an_absent_stale_or_future_clock(last_gc):
    p = plan(base(last_gc=last_gc, candidates=(blob("past", NOW - GRACE_MS - 1, 0),), trashed=(TrashedEntry("old", 0),)))
    assert p.rebase
    assert p.delete_blobs == p.delete_entries == p.urgent_blobs == ()


def collect(store, live=frozenset()):
    return apply(store, plan(survey(store, store.layout, store.inflight, lambda: set(live))), lambda: set(live))


def start_clock(store, clock):
    store.set_meta("last_gc", str(clock.now))


def test_apply_deletes_the_row_then_the_file(store, clock):
    row, _ = put(store, png(1))
    start_clock(store, clock)
    clock.advance(GRACE_MS + HOUR_MS)
    with store.db.write() as w:
        w.conn.execute("UPDATE blobs SET unnamed_since = ?", (clock.now - GRACE_MS - 1,))
    store.set_meta("last_gc", str(clock.now - PASS_MS))
    applied = collect(store)
    assert applied.blobs == 1
    assert store.row(row.hash) is None
    assert not os.path.exists(store.layout.blob_path(row.hash, row.ext))


def test_apply_frees_an_expired_entry_and_its_blob_in_one_pass(store, clock):
    row, _ = put(store, png(1))
    shared, _ = put(store, png(2))
    link_entry(store, "old", [row.hash, shared.hash], trashed_at=clock.now)
    link_record(store, "job", [shared.hash])
    clock.advance(8 * DAY_MS)
    store.set_meta("last_gc", str(clock.now - PASS_MS))
    applied = collect(store)
    assert applied.entries == 1
    assert store.row(row.hash) is None
    assert store.row(shared.hash) is not None


def test_apply_reports_what_it_expired_evicted_and_retired_as_change_events(store, clock, monkeypatch):
    monkeypatch.setattr(events, "versions", {})
    monkeypatch.setattr(events, "logs", {})
    row, _ = put(store, png(1))
    store.update_settings({"library_cap": 10})
    link_entry(store, "expired", [row.hash], trashed_at=clock.now)
    for i in range(12):
        link_entry(store, f"e{i:02d}", [row.hash])
    with store.db.write() as w:
        w.conn.execute("UPDATE entries SET pinned = 1 WHERE id = 'e00'")
    link_record(store, "idle", [], client="gone", created_at=clock.now - CLIENT_IDLE_MS)
    clock.advance(8 * DAY_MS)
    store.set_meta("last_gc", str(clock.now - PASS_MS))
    applied = collect(store)
    assert (applied.expired, applied.evicted, applied.retired) == (["expired"], ["e01"], ["idle"])
    owed = {event["type"]: event["data"].get("ids") for event in events.pending({})}
    assert owed == {"trash": ["e01", "expired"], "library": ["e01"], "records": ["idle"], "media": None}


def test_apply_keeps_a_blob_named_since_the_plan(store, clock):
    row, _ = put(store, png(1))
    clock.advance(GRACE_MS + HOUR_MS)
    store.set_meta("last_gc", str(clock.now - PASS_MS))
    with store.db.write() as w:
        w.conn.execute("UPDATE blobs SET unnamed_since = ?", (clock.now - GRACE_MS - 1,))
    planned = plan(survey(store, store.layout, store.inflight, set))
    assert planned.delete_blobs == (row.hash,)
    link_entry(store, "new", [row.hash])
    applied = apply(store, planned, set)
    assert applied.kept == 1
    assert store.get(row.hash) is not None


def test_apply_leaves_the_file_when_the_row_stays(store, clock):
    row, _ = put(store, png(1))
    clock.advance(GRACE_MS + HOUR_MS)
    store.set_meta("last_gc", str(clock.now - PASS_MS))
    planned = plan(survey(store, store.layout, store.inflight, set))
    store.claim([row.hash])
    applied = apply(store, planned, set)
    assert applied.blobs == 0
    assert os.path.exists(store.layout.blob_path(row.hash, row.ext))


def test_apply_releases_the_lock_between_batches(store, clock, monkeypatch):
    rows = [put(store, png(i))[0] for i in range(DELETE_BATCH * 2 + 3)]
    clock.advance(GRACE_MS + HOUR_MS)
    store.set_meta("last_gc", str(clock.now - PASS_MS))
    blocks = []
    real = store.db.write

    def counting():
        blocks.append(1)
        return real()

    monkeypatch.setattr(store.db, "write", counting)
    applied = collect(store)
    assert applied.blobs == len(rows)
    assert len(blocks) >= 3


def test_apply_rebases_and_deletes_nothing(store, clock):
    row, _ = put(store, png(1))
    link_entry(store, "old", [], trashed_at=0)
    clock.advance(30 * DAY_MS)
    applied = collect(store)
    assert applied.rebased == 2
    assert store.row(row.hash).unnamed_since == clock.now
    assert store.meta("last_gc") == str(clock.now)


def test_apply_drops_names_only_while_the_job_is_not_live(store, clock):
    row, _ = put(store, png(1))
    store.name_job("job", [row.hash])
    clock.advance(2 * PASS_MS)
    store.set_meta("last_gc", str(clock.now - PASS_MS))
    planned = plan(survey(store, store.layout, store.inflight, set))
    assert planned.drop_job_names == ("job",)
    assert apply(store, planned, lambda: {"job"}).names == 0
    assert apply(store, planned, set).names == 1


def test_apply_removes_old_parts_only(store, clock):
    old = store.layout.new_part()
    young = store.layout.new_part()
    for path in (old, young):
        with open(path, "wb") as f:
            f.write(b"x")
    stamp = (clock.now - 2 * HOUR_MS) / 1000
    os.utime(old, (stamp, stamp))
    os.utime(young, (clock.now / 1000, clock.now / 1000))
    store.set_meta("last_gc", str(clock.now - PASS_MS))
    assert collect(store).parts == 1
    assert not os.path.exists(old)
    assert os.path.exists(young)


@pytest.mark.slow
def test_plan_over_many_candidates_is_quick():
    candidates = tuple(blob(f"{i:064x}", NOW - GRACE_MS - 1 if i % 2 else NOW, 0) for i in range(100_000))
    started = time.perf_counter()
    p = plan(base(candidates=candidates))
    assert len(p.delete_blobs) == 50_000
    assert time.perf_counter() - started < 10


def test_survey_lists_parts_with_registration(store):
    part = store.layout.new_part()
    with open(part, "wb") as f:
        f.write(b"x")
    token = store.inflight.register(1, part)
    assert [p.registered for p in survey(store, store.layout, store.inflight, set).parts] == [True]
    store.inflight.release(token)
    assert [p.registered for p in survey(store, store.layout, store.inflight, set).parts] == [False]
