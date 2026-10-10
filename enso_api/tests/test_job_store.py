import os
import sqlite3

from enso_api.job_store import SCHEMA_V1, JobStore


def test_existing_file_is_stamped_without_a_change(root):
    path = os.path.join(root, "jobs.db")
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA_V1)
    conn.execute("INSERT INTO jobs (id, type, params, created_at) VALUES ('a', 'generate', '{}', '2026-10-10T00:00:00+00:00')")
    conn.commit()
    conn.close()
    store = JobStore(path)
    assert store.db.version == 1
    assert store.get("a")["status"] == "pending"
    store.close()


def test_live_ids_are_every_pending_and_running_job(root):
    store = JobStore(os.path.join(root, "jobs.db"))
    rows = [(f"job{i:04d}", "generate", "pending", "{}", "2026-10-10T00:00:00+00:00") for i in range(1100)]
    with store.db.write() as w:
        w.conn.executemany("INSERT INTO jobs (id, type, status, params, created_at) VALUES (?, ?, ?, ?, ?)", rows)
    store.update_status("job0000", "running")
    store.update_status("job0001", "completed")
    store.update_status("job0002", "cancelled")
    live = store.live_ids()
    assert len(live) == 1098
    assert "job0000" in live
    assert "job0001" not in live
    store.close()


def test_delete_removes_the_staging_folder_after_the_row(root):
    store = JobStore(os.path.join(root, "jobs.db"))
    staging = os.path.join(root, "staging")
    os.makedirs(staging)
    job = store.create("generate", {})
    store.update_status(job["id"], "completed", result={"_staging_dir": staging})
    assert store.delete(job["id"])
    assert store.get(job["id"]) is None
    assert not os.path.exists(staging)
    store.close()
