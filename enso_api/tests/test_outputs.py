import os
from datetime import datetime, timedelta, timezone

import pytest

from enso_api.job_store import OUTPUT_MTIME_SLACK_MS, JobStore, path_spellings


@pytest.fixture
def store(root):
    made = JobStore(os.path.join(root, "jobs.db"))
    yield made
    made.close()


def output(root: str, name: str, mtime: datetime) -> str:
    path = os.path.join(root, name)
    with open(path, "wb") as f:
        f.write(b"x")
    os.utime(path, (mtime.timestamp(), mtime.timestamp()))
    return path


def row(store: JobStore, path: str, job_id: str, created: datetime) -> None:
    with store.db.write() as w:
        w.conn.execute("INSERT INTO outputs (id, path, job_id, created_at) VALUES (?, ?, ?, ?)", (job_id + "-out", path, job_id, created.isoformat()))


def ms(moment: datetime) -> int:
    return int(moment.timestamp() * 1000)


NOW = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)


def test_a_file_is_found_under_any_spelling_its_row_used(store, root, monkeypatch):
    real = output(root, "a.png", NOW)
    linked = os.path.join(root, "link.png")
    os.symlink(real, linked)
    row(store, real, "resolved", NOW)
    assert store.output_job(path_spellings(linked), ms(NOW)) == "resolved"
    assert store.output_job(path_spellings(os.path.join(root, ".", "a.png")), ms(NOW)) == "resolved"
    monkeypatch.chdir(root)
    relative = output(root, "b.png", NOW)
    row(store, "b.png", "relative", NOW)
    assert store.output_job(path_spellings(relative), ms(NOW)) == "relative"


def test_the_newest_row_names_the_job(store, root):
    path = output(root, "a.png", NOW)
    row(store, path, "old", NOW - timedelta(days=2))
    row(store, path, "new", NOW)
    assert store.output_job(path_spellings(path), ms(NOW)) == "new"


def test_a_file_newer_than_its_row_by_more_than_the_slack_names_no_job(store, root):
    rewritten = NOW + timedelta(milliseconds=OUTPUT_MTIME_SLACK_MS + 1000)
    path = output(root, "a.png", rewritten)
    row(store, path, "job1", NOW)
    assert store.output_job(path_spellings(path), ms(rewritten)) is None
    assert store.output_job(path_spellings(path), ms(NOW + timedelta(seconds=30))) == "job1"


def test_an_unknown_file_names_no_job(store, root):
    path = output(root, "a.png", NOW)
    assert store.output_job(path_spellings(path), ms(NOW)) is None
    assert store.output_job([], ms(NOW)) is None


def test_an_output_is_registered_by_its_real_path(store, root):
    path = output(root, "a.png", NOW)
    output_id = store.register_output(os.path.join(root, ".", "a.png"), job_id="job1")
    assert store.resolve_output(output_id)["path"] == os.path.realpath(path)


def test_a_conditional_status_write_leaves_a_finished_row_alone(store):
    job = store.insert("generate", {}, job_id="a")
    assert job == store.get("a")
    assert store.update_status("a", "completed", current=("pending", "running"))
    assert not store.update_status("a", "failed", current=("pending", "running"), error="late")
    assert store.get("a")["status"] == "completed"


def test_output_ids_at_finds_each_file_under_any_spelling(store, root, monkeypatch):
    a = output(root, "a.png", NOW)
    b = output(root, "b.png", NOW)
    linked = os.path.join(root, "link.png")
    os.symlink(a, linked)
    row(store, a, "first", NOW)
    monkeypatch.chdir(root)
    row(store, "b.png", "second", NOW)
    found = store.output_ids_at({linked: ms(NOW), b: ms(NOW), os.path.join(root, "none.png"): ms(NOW)})
    assert found == {linked: ["first-out"], b: ["second-out"], os.path.join(root, "none.png"): []}


def test_output_ids_at_leaves_out_an_earlier_file_at_the_path(store, root):
    rewritten = NOW + timedelta(days=1)
    path = output(root, "a.png", rewritten)
    row(store, path, "earlier", NOW)
    row(store, path, "current", rewritten)
    assert store.output_ids_at({path: ms(rewritten)}) == {path: ["current-out"]}


def test_output_ids_at_reads_past_one_query(store, root):
    paths = {output(root, f"{i:04d}.png", NOW): ms(NOW) for i in range(700)}
    for i, path in enumerate(paths):
        row(store, path, f"job{i:04d}", NOW)
    found = store.output_ids_at(paths)
    assert all(ids == [f"job{i:04d}-out"] for i, ids in enumerate(found.values()))


def test_repathed_rows_follow_the_file(store, root):
    path = output(root, "a.png", NOW)
    row(store, path, "job1", NOW)
    os.makedirs(os.path.join(root, "moved"))
    moved = os.path.join(root, "moved", "a.png")
    os.rename(path, moved)
    assert store.repath_outputs([("job1-out", moved)]) == 1
    assert store.repath_outputs([]) == 0
    assert store.resolve_output("job1-out")["path"] == os.path.realpath(moved)
    assert store.output_job(path_spellings(moved), ms(NOW)) == "job1"
