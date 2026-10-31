import errno
import os
import time

import pytest

from enso_api.job_store import JobStore
from enso_api.media import moving
from enso_api.media.companions import TAKEN, gather
from enso_api.media.moving import ALREADY_HERE, move, part_of

AN_HOUR_AGO = 3600.0


@pytest.fixture
def jobs(root):
    made = JobStore(os.path.join(root, "jobs.db"))
    yield made
    made.close()


@pytest.fixture
def folders(root):
    source, destination = os.path.join(root, "outputs", "text"), os.path.join(root, "outputs", "kept")
    os.makedirs(source)
    os.makedirs(destination)
    return source, os.path.realpath(destination)


def write(folder: str, name: str, data: bytes = b"picture") -> str:
    path = os.path.join(folder, name)
    with open(path, "wb") as f:
        f.write(data)
    then = time.time() - AN_HOUR_AGO
    os.utime(path, (then, then))
    return path


def picture(jobs: JobStore, folder: str) -> dict[str, str]:
    """A picture with its infotext and thumbnail; the picture and the thumbnail have outputs rows."""
    path = write(folder, "a.png", b"png bytes")
    write(folder, "a.txt", b"infotext")
    thumb = write(folder, "a.png.thumb.png", b"thumb")
    return {jobs.register_output(path, "job1"): "a.png", jobs.register_output(thumb, "job1"): "a.png.thumb.png"}


def items(*paths: str):
    found, errors = gather(paths, lambda _: True, [], time.time())
    assert errors == []
    return found


def journal(jobs: JobStore) -> list[str]:
    with jobs.db.read() as conn:
        return sorted(found[0] for found in conn.execute("SELECT output_id FROM output_moves"))


def test_a_move_carries_the_sidecars_and_the_rows_follow(jobs, folders):
    source, destination = folders
    rows = picture(jobs, source)
    result = move(items(os.path.join(source, "a.png")), destination, jobs)
    assert result.errors == []
    assert result.moved == [os.path.join(source, "a.png"), os.path.join(source, "a.png.thumb.png")]
    assert sorted(os.listdir(destination)) == ["a.png", "a.png.thumb.png", "a.txt"]
    assert os.listdir(source) == []
    for output_id, name in rows.items():
        assert jobs.resolve_output(output_id)["path"] == os.path.join(destination, name)
    assert journal(jobs) == []


def test_a_name_taken_in_the_destination_refuses_the_item_and_journals_nothing(jobs, folders, monkeypatch):
    source, destination = folders
    rows = picture(jobs, source)
    write(destination, "a.txt", b"another")
    monkeypatch.setattr(jobs, "plan_moves", lambda moves: pytest.fail("journalled a refused item"))
    result = move(items(os.path.join(source, "a.png")), destination, jobs)
    assert result.errors == [{"file": os.path.join(source, "a.png"), "error": "A file named a.txt is already there"}]
    assert sorted(os.listdir(source)) == ["a.png", "a.png.thumb.png", "a.txt"]
    for output_id, name in rows.items():
        assert jobs.resolve_output(output_id)["path"] == os.path.join(os.path.realpath(source), name)


def test_a_file_already_in_the_folder_is_refused(jobs, folders):
    source, _ = folders
    picture(jobs, source)
    result = move(items(os.path.join(source, "a.png")), os.path.realpath(source), jobs)
    assert result.errors == [{"file": os.path.join(source, "a.png"), "error": ALREADY_HERE}]


def test_a_file_that_cannot_be_placed_keeps_its_rows_and_clears_the_journal(jobs, folders, monkeypatch):
    source, destination = folders
    rows = picture(jobs, source)
    real_place = moving.place

    def place(src, dst, part=None):
        if os.path.basename(src) == "a.png":
            raise FileExistsError(errno.EEXIST, "File exists", dst)
        real_place(src, dst, part)

    monkeypatch.setattr(moving, "place", place)
    result = move(items(os.path.join(source, "a.png")), destination, jobs)
    assert result.errors == [{"file": os.path.join(source, "a.png"), "error": TAKEN}]
    assert result.moved == []
    for output_id, name in rows.items():
        assert jobs.resolve_output(output_id)["path"] == os.path.join(os.path.realpath(source), name)
    assert journal(jobs) == []


def test_a_crash_after_the_files_moved_is_settled_at_start(jobs, folders, monkeypatch):
    source, destination = folders
    rows = picture(jobs, source)

    def crash(moved, planned):
        raise RuntimeError("crash")

    monkeypatch.setattr(jobs, "finish_moves", crash)
    with pytest.raises(RuntimeError):
        move(items(os.path.join(source, "a.png")), destination, jobs)
    assert sorted(os.listdir(destination)) == ["a.png", "a.png.thumb.png", "a.txt"]
    assert journal(jobs) == sorted(rows)
    monkeypatch.undo()
    jobs.close()
    reopened = JobStore(jobs.db_path)
    try:
        reopened.settle_moves()
        for output_id, name in rows.items():
            assert reopened.resolve_output(output_id)["path"] == os.path.join(destination, name)
        assert journal(reopened) == []
    finally:
        reopened.close()


def test_a_copy_across_disks_writes_its_part_where_a_start_finds_it(jobs, folders, monkeypatch):
    source, destination = folders
    picture(jobs, source)
    parts: list[tuple[str, str | None]] = []
    real_place = moving.place

    def place(src, dst, part=None):
        parts.append((dst, part))
        real_place(src, dst, part)

    monkeypatch.setattr(moving, "place", place)
    move(items(os.path.join(source, "a.png")), destination, jobs)
    assert len(parts) == 3
    assert all(part == part_of(dst) for dst, part in parts)


def test_a_part_a_crash_left_is_removed_at_start(jobs, folders):
    source, destination = folders
    [(output_id, _)] = [(output_id, name) for output_id, name in picture(jobs, source).items() if name == "a.png"]
    target = os.path.join(destination, "a.png")
    jobs.plan_moves([(output_id, os.path.join(source, "a.png"), target)])
    write(destination, os.path.basename(part_of(target)), b"half a copy")
    jobs.settle_moves()
    assert os.listdir(destination) == []
    assert jobs.resolve_output(output_id)["path"] == os.path.join(os.path.realpath(source), "a.png")


def test_a_part_left_by_an_earlier_crash_does_not_block_a_copy_across_disks(jobs, folders, monkeypatch):
    source, destination = folders
    picture(jobs, source)
    mtime = os.stat(os.path.join(source, "a.png")).st_mtime_ns
    target = os.path.join(destination, "a.png")
    write(destination, os.path.basename(part_of(target)), b"half a copy")
    real_link = os.link

    def link(src, dst, *args, **kwargs):
        if not os.path.basename(src).startswith(".enso-"):
            raise OSError(errno.EXDEV, "Invalid cross-device link")
        return real_link(src, dst, *args, **kwargs)

    monkeypatch.setattr(os, "link", link)
    result = move(items(os.path.join(source, "a.png")), destination, jobs)
    assert result.errors == []
    assert sorted(os.listdir(destination)) == ["a.png", "a.png.thumb.png", "a.txt"]
    assert os.stat(target).st_mtime_ns == mtime
