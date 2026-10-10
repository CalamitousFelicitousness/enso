import json
import os
import threading

from enso_api.media import verify
from enso_api.media.tests.helpers import files_in, png, put


def run(store, layout, cancel=None, progress=None):
    return verify.run(store, layout, cancel or threading.Event(), progress or (lambda checked, total: None))


def test_a_corrupt_file_moves_and_its_row_is_lost(store, layout):
    good, _ = put(store, png(1))
    bad, _ = put(store, png(2))
    with open(layout.blob_path(bad.hash, bad.ext), "r+b") as f:
        f.seek(40)
        f.write(b"\xff\xff")
    result = run(store, layout)
    assert (result.checked, result.corrupt, result.lost) == (2, 1, 0)
    assert store.row(bad.hash).lost_at is not None
    assert store.get(good.hash) is not None
    assert files_in(layout.corrupt) == [f"{bad.hash}.png"]
    assert json.loads(store.meta("last_verify"))["corrupt"] == 1


def test_a_file_replaced_while_hashed_is_left(store, layout, monkeypatch):
    row, _ = put(store, png(1))
    path = layout.blob_path(row.hash, row.ext)
    real = verify.hash_file

    def hash_then_heal(target):
        result = real(target)
        os.remove(target)
        with open(target, "wb") as f:
            f.write(png(1))
        return "0" * 64, result[1]

    monkeypatch.setattr(verify, "hash_file", hash_then_heal)
    result = run(store, layout)
    assert (result.changed, result.corrupt) == (1, 0)
    assert os.path.exists(path)
    assert store.row(row.hash).lost_at is None


def test_a_file_gone_counts_as_lost(store, layout):
    row, _ = put(store, png(1))
    os.remove(layout.blob_path(row.hash, row.ext))
    assert run(store, layout).lost == 1


def test_cancel_stops_between_files(store, layout):
    for i in range(5):
        put(store, png(i))
    cancel = threading.Event()
    seen = []

    def progress(checked, total):
        seen.append((checked, total))
        cancel.set()

    result = run(store, layout, cancel, progress)
    assert result.cancelled
    assert result.checked == 0
    assert seen[0] == (0, 5)
    assert json.loads(store.meta("last_verify"))["cancelled"] is True
