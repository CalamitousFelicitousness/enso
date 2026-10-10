import os
import stat

import pytest

from enso_api.media.ingest import BATCH
from enso_api.media.settings import BOUNDS
from enso_api.media.store import SnapshotExists
from enso_api.media.tests.helpers import files_in, finish, link_entry, link_record, png, put

HOUR = 3600 * 1000


def test_place_creates_the_file_and_the_row(store, layout):
    finished, part = finish(store, png(1))
    row, created = store.place(finished, part, transient=False)
    assert created
    assert (row.ext, row.type, row.size) == ("png", "image/png", len(png(1)))
    assert row.unnamed_since == store.now()
    assert os.path.isfile(layout.blob_path(row.hash, "png"))
    assert not os.path.exists(part)


def test_the_same_bytes_again_are_held(store, clock):
    first, _ = put(store, png(1))
    clock.advance(1000)
    finished, part = finish(store, png(1))
    row, created = store.place(finished, part, transient=False)
    assert not created
    assert not os.path.exists(part)
    assert row.touched_at == first.touched_at + 1000
    assert row.created_at == first.created_at


def test_a_lost_row_heals_on_ingest(store, layout):
    row, _ = put(store, png(1))
    os.remove(layout.blob_path(row.hash, row.ext))
    assert store.claim([row.hash]).lost == [row.hash]
    assert store.row(row.hash).lost_at is not None
    healed, created = put(store, png(1))
    assert not created
    assert healed.lost_at is None
    assert store.get(row.hash) is not None


def test_a_file_of_another_size_is_replaced(store, layout):
    row, _ = put(store, png(1))
    path = layout.blob_path(row.hash, row.ext)
    with open(path, "wb") as f:
        f.write(b"truncated")
    assert store.get(row.hash) is None
    put(store, png(1))
    with open(path, "rb") as f:
        assert f.read() == png(1)


def test_transient_is_cleared_by_a_kept_ingest_and_by_a_claim(store):
    row, _ = put(store, png(1), transient=True)
    assert row.transient
    assert put(store, png(1), transient=True)[0].transient
    assert not put(store, png(1))[0].transient
    other, _ = put(store, png(2), transient=True)
    store.claim([other.hash])
    assert not store.row(other.hash).transient


def test_get_never_writes(store, layout):
    row, _ = put(store, png(1))
    os.remove(layout.blob_path(row.hash, row.ext))
    assert store.get(row.hash) is None
    assert store.row(row.hash).lost_at is None


def test_claim_sorts_present_missing_and_lost(store, layout, clock):
    held, _ = put(store, png(1))
    gone, _ = put(store, png(2))
    os.remove(layout.blob_path(gone.hash, gone.ext))
    clock.advance(HOUR)
    unknown = "f" * 64
    claim = store.claim([held.hash, unknown, "not-a-hash", gone.hash, held.hash])
    assert claim.present == [held.hash]
    assert claim.missing == [unknown, "not-a-hash"]
    assert claim.lost == [gone.hash]
    assert store.row(held.hash).touched_at == clock.now
    assert store.row(gone.hash).lost_at == clock.now


def test_refs_resolve_by_hash_and_through_legacy_ids(store):
    row, _ = put(store, png(1))
    with store.db.write() as w:
        w.conn.execute("INSERT INTO legacy_uploads (id, hash) VALUES ('0123456789abcdef', ?)", (row.hash,))
    assert store.resolve_ref(row.hash) == row.hash
    assert store.resolve_ref("0123456789abcdef") == row.hash
    assert store.resolve_ref("fedcba9876543210") is None
    assert store.resolve_ref("../../etc/passwd") is None
    assert store.resolve_ref(row.hash.upper()) is None
    assert store.resolve_to_path("0123456789abcdef").endswith(f"{row.hash}.png")
    assert store.resolve_to_image(row.hash).size == (8, 8)
    assert store.holds(row.hash)
    assert not store.holds("e" * 64)


def test_legacy_uploads_are_taken_in_and_named_by_pending_jobs(store, root):
    folder = os.path.join(root, "uploads")
    os.makedirs(folder)
    for i, ref in enumerate(("0123456789abcdef", "00000000000000aa")):
        with open(os.path.join(folder, f"{ref}.png"), "wb") as f:
            f.write(png(i))
    assert store.take_legacy_uploads(folder) == 2
    assert not os.path.exists(folder)
    assert store.name_job("job1", ["0123456789abcdef", "00000000000000aa"]) == []
    with store.db.read() as conn:
        assert {row[0] for row in conn.execute("SELECT hash FROM job_blobs WHERE job_id = 'job1'")} == {store.resolve_ref("0123456789abcdef"), store.resolve_ref("00000000000000aa")}
    assert all(store.row(store.resolve_ref(ref)).transient for ref in ("0123456789abcdef", "00000000000000aa"))


def test_an_unreadable_legacy_upload_is_left(store, root):
    if os.geteuid() == 0:
        pytest.skip("root reads every file")
    folder = os.path.join(root, "uploads")
    os.makedirs(folder)
    path = os.path.join(folder, "0123456789abcdef.png")
    with open(path, "wb") as f:
        f.write(png(1))
    os.chmod(path, 0)
    try:
        assert store.take_legacy_uploads(folder) == 0
        assert os.path.exists(path)
    finally:
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)


def test_name_job_answers_what_it_could_not_name_and_stamps_named_at(store, layout, clock):
    row, _ = put(store, png(1))
    gone, _ = put(store, png(2))
    os.remove(layout.blob_path(gone.hash, gone.ext))
    clock.advance(5)
    assert store.name_job("job1", [row.hash, "e" * 64, "junk", row.hash, gone.hash]) == sorted(["e" * 64, "junk", gone.hash])
    assert store.name_job("job1", [row.hash]) == []
    with store.db.read() as conn:
        assert conn.execute("SELECT named_at FROM job_blobs WHERE job_id = 'job1'").fetchone()[0] == clock.now
    assert store.row(row.hash).unnamed_since is None
    assert store.jobs_named() == {"job1"}
    store.release_job("job1")
    assert store.jobs_named() == set()
    assert store.row(row.hash).unnamed_since is not None


def test_settings_clamp_on_read_and_on_write(store):
    assert store.settings().trash_days == BOUNDS["trash_days"].default
    with store.db.write() as w:
        w.conn.execute("INSERT INTO settings (key, value) VALUES ('trash_days', '90'), ('library_cap', 'many')")
    assert store.settings().trash_days == 30
    assert store.settings().library_cap == BOUNDS["library_cap"].default
    updated = store.update_settings({"record_cap": 10})
    assert updated.record_cap == BOUNDS["record_cap"].low
    assert updated.trash_days == 30
    assert store.update_settings({"trash_days": 3}).trash_days == 3


def test_report_counts_each_blob_under_its_first_term(store, layout):
    library, _ = put(store, png(1))
    record, _ = put(store, png(2))
    trash, _ = put(store, png(3))
    loose, _ = put(store, png(4))
    lost, _ = put(store, png(5))
    link_entry(store, "kept", [library.hash])
    link_entry(store, "removed", [trash.hash, library.hash], trashed_at=1)
    link_record(store, "job1", [record.hash, trash.hash])
    os.remove(layout.blob_path(lost.hash, lost.ext))
    store.claim([lost.hash])
    report = store.report()
    assert report.by_term["library"].count == 1
    assert report.by_term["records"].count == 2
    assert report.by_term["trash"].count == 0
    assert report.by_term["unnamed"].count == 1
    assert report.by_term["unnamed"].bytes == loose.size
    assert report.lost == 1
    assert report.count == 4


def test_snapshot_refuses_a_same_moment_name(store, layout):
    put(store, png(1))
    path, size = store.snapshot()
    assert os.path.getsize(path) == size
    assert not os.stat(path).st_mode & 0o111
    assert os.path.dirname(path) == layout.snapshots
    with pytest.raises(SnapshotExists):
        store.snapshot()


def test_ingest_file_streams_in_batches(store, root):
    path = os.path.join(root, "big.bin")
    with open(path, "wb") as f:
        f.write(os.urandom(BATCH * 2 + 5))
    row, created = store.ingest_file(path)
    assert created
    assert row.size == BATCH * 2 + 5
    assert row.ext == "bin"
    assert files_in(store.layout.tmp) == []
    assert store.inflight.parts() == set()


def test_under_root(store, layout, root):
    assert store.under_root(layout.root)
    assert store.under_root(os.path.join(layout.blobs, "ab"))
    assert not store.under_root(root)
    assert not store.under_root(layout.root + "-other")


def test_claim_reports_a_blob_collected_meanwhile_as_missing(store, monkeypatch):
    row, _ = put(store, png(1))
    real = store.file_ok

    def collected_after_the_stat(blob):
        present = real(blob)
        with store.db.write() as w:
            w.conn.execute("DELETE FROM blobs WHERE hash = ?", (blob.hash,))
        return present

    monkeypatch.setattr(store, "file_ok", collected_after_the_stat)
    claim = store.claim([row.hash])
    assert claim.present == []
    assert claim.missing == [row.hash]


def test_claim_reports_a_blob_lost_meanwhile_as_lost(store, monkeypatch):
    row, _ = put(store, png(1))
    real = store.file_ok

    def lost_after_the_stat(blob):
        present = real(blob)
        with store.db.write() as w:
            w.conn.execute("UPDATE blobs SET lost_at = 1 WHERE hash = ?", (blob.hash,))
        return present

    monkeypatch.setattr(store, "file_ok", lost_after_the_stat)
    claim = store.claim([row.hash])
    assert (claim.present, claim.lost) == ([], [row.hash])


def test_a_part_that_cannot_open_releases_its_reservation(store, layout):
    os.rmdir(layout.tmp)
    with pytest.raises(OSError):
        store.ingest_bytes(b"x" * 1000)
    assert store.inflight.outstanding() == 0
