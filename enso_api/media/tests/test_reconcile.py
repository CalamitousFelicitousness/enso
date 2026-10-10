import hashlib
import os

from enso_api.media.collector import reconcile
from enso_api.media.tests.helpers import files_in, png, put


def stray(layout, data: bytes, digest: str | None = None, ext: str = "png") -> str:
    digest = digest or hashlib.sha256(data).hexdigest()
    folder = layout.fan_dir(digest)
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{digest}.{ext}")
    with open(path, "wb") as f:
        f.write(data)
    return path


def test_marks_lost_and_clears_found(store, layout):
    row, _ = put(store, png(1))
    path = layout.blob_path(row.hash, row.ext)
    os.rename(path, path + ".away")
    assert reconcile(store, layout, walk=True).lost == 1
    assert store.row(row.hash).lost_at is not None
    os.rename(path + ".away", path)
    assert reconcile(store, layout, walk=True).found == 1
    assert store.get(row.hash) is not None


def test_adopts_a_stray_whose_hash_matches(store, layout, clock):
    data = png(7)
    stray(layout, data)
    result = reconcile(store, layout, walk=True)
    assert result.adopted == 1
    row = store.row(hashlib.sha256(data).hexdigest())
    assert (row.type, row.size, row.unnamed_since) == ("image/png", len(data), clock.now)


def test_moves_a_stray_whose_hash_differs(store, layout):
    path = stray(layout, png(7), digest="ab" + "0" * 62)
    result = reconcile(store, layout, walk=True)
    assert result.corrupt == 1
    assert not os.path.exists(path)
    assert files_in(layout.corrupt) == [os.path.basename(path)]


def test_reports_other_files_without_touching_them(store, layout):
    data = png(1)
    digest = hashlib.sha256(data).hexdigest()
    wrong_fan = os.path.join(layout.blobs, "zz")
    os.makedirs(wrong_fan)
    paths = [os.path.join(wrong_fan, f"{digest}.png"), os.path.join(wrong_fan, "notes.txt"), os.path.join(layout.blobs, "README")]
    for path in paths:
        with open(path, "wb") as f:
            f.write(data)
    result = reconcile(store, layout, walk=True)
    assert sorted(result.unknown) == sorted(paths)
    assert result.adopted == result.corrupt == 0
    assert all(os.path.exists(path) for path in paths)


def test_leaves_parts_alone(store, layout):
    part = layout.new_part()
    with open(part, "wb") as f:
        f.write(b"in progress")
    reconcile(store, layout, walk=True)
    assert os.path.exists(part)


def test_a_pass_checks_only_the_candidates(store, layout):
    named, _ = put(store, png(1))
    loose, _ = put(store, png(2))
    store.name_job("job", [named.hash])
    os.remove(layout.blob_path(named.hash, named.ext))
    os.remove(layout.blob_path(loose.hash, loose.ext))
    result = reconcile(store, layout, walk=False)
    assert result.lost == 1
    assert store.row(loose.hash).lost_at is not None
    assert store.row(named.hash).lost_at is None
