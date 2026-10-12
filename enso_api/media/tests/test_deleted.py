import errno
import json
import os
import time

import pytest

from enso_api.confine import allowed_gallery_path
from enso_api.media import deleted as deleted_module
from enso_api.media.companions import MODEL_FOLDERS_KEPT, NOT_FOUND, PATH_NOT_ALLOWED
from enso_api.media.deleted import DISK_CANNOT_TAKE, FOLDER_LEFT_GALLERY, GONE_KEPT_MS, MANIFEST, NOT_IN_TRASH, DeletedFiles, Lookups, Reconciled
from enso_api.media.settings import DAY_MS, Settings

AN_HOUR_AGO = 3600.0


class Outputs:
    """The outputs table: an id to the path its row names."""

    def __init__(self):
        self.paths: dict[str, str] = {}

    def add(self, output_id: str, path: str) -> None:
        self.paths[output_id] = os.path.realpath(path)

    def ids_at(self, files):
        return {path: [output_id for output_id, at in sorted(self.paths.items()) if at == os.path.realpath(path)] for path in files}

    def repath(self, pairs) -> int:
        count = 0
        for output_id, path in pairs:
            self.paths[output_id] = os.path.realpath(path)
            count += 1
        return count

    def path(self, output_id: str) -> str | None:
        return self.paths.get(output_id)


@pytest.fixture
def outputs():
    return Outputs()


@pytest.fixture
def space():
    return {"free": 1 << 40}


@pytest.fixture
def gallery(root):
    folder = os.path.join(root, "outputs")
    os.makedirs(folder)
    return folder


@pytest.fixture
def trash(db, layout, clock, outputs, gallery, root, space):
    lookups = Lookups(
        output_ids_at=outputs.ids_at,
        repath_outputs=outputs.repath,
        output_path=outputs.path,
        gallery_allows=lambda path: allowed_gallery_path(path, [gallery], layout.root),
        protected=lambda: [(os.path.realpath(os.path.join(root, "models")), MODEL_FOLDERS_KEPT)],
        free_space=lambda path: space["free"],
    )
    return DeletedFiles(db, layout, lookups, lambda: Settings(trash_days=7, reserve_bytes=1 << 20), clock)


def write(folder: str, name: str, data: bytes = b"picture", age: float = AN_HOUR_AGO) -> str:
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, name)
    with open(path, "wb") as f:
        f.write(data)
    then = time.time() - age
    os.utime(path, (then, then))
    return path


def row_of(trash: DeletedFiles, item_id: str):
    with trash.db.read() as conn:
        return conn.execute("SELECT * FROM trashed_files WHERE id = ?", (item_id,)).fetchone()


def held_outputs(trash: DeletedFiles) -> dict[str, str]:
    with trash.db.read() as conn:
        return {row[0]: row[1] for row in conn.execute("SELECT output_id, item_id FROM trashed_outputs")}


def picture_with_sidecars(gallery: str, outputs: Outputs, stem: str = "a") -> tuple[str, str]:
    folder = os.path.join(gallery, "text")
    picture = write(folder, f"{stem}.png", b"png bytes")
    write(folder, f"{stem}.txt", b"infotext")
    thumb = write(folder, f"{stem}.png.thumb.png", b"thumb")
    outputs.add(f"{stem}-png", picture)
    outputs.add(f"{stem}-thumb", thumb)
    return folder, picture


def test_a_trash_moves_the_file_and_its_sidecars_into_a_folder_of_its_own(trash, gallery, outputs, layout, clock):
    folder, picture = picture_with_sidecars(gallery, outputs)
    result = trash.trash([picture], "alice")
    assert result.errors == []
    [item] = result.items
    inside = layout.item_dir(item["id"])
    assert sorted(os.listdir(inside)) == ["a.png", "a.png.thumb.png", "a.txt", MANIFEST]
    assert sorted(os.listdir(folder)) == []
    assert outputs.paths == {"a-png": os.path.realpath(os.path.join(inside, "a.png")), "a-thumb": os.path.realpath(os.path.join(inside, "a.png.thumb.png"))}
    assert held_outputs(trash) == {"a-png": item["id"], "a-thumb": item["id"]}
    assert item["output_ids"] == ["a-png", "a-thumb"]
    assert item["path"] == os.path.join(inside, "a.png")
    assert (item["kind"], item["size"], item["bytes"], item["trashed_by"]) == ("image", 9, 9 + 8 + 5, "alice")
    assert item["expires_at"] == clock.now + 7 * DAY_MS
    assert result.moved == [{"file": picture, "path": os.path.join(inside, "a.png")}, {"file": os.path.join(folder, "a.png.thumb.png"), "path": os.path.join(inside, "a.png.thumb.png")}]
    row = row_of(trash, item["id"])
    assert row["state"] == "trashed"
    assert json.loads(row["companions"]) == ["a.png.thumb.png", "a.txt"]
    with open(os.path.join(inside, MANIFEST), encoding="utf-8") as f:
        manifest = json.load(f)
    assert manifest["outputs"] == [["a-png", "a.png"], ["a-thumb", "a.png.thumb.png"]]
    assert result.folders == {os.path.realpath(folder)}


def test_a_file_already_in_the_trash_is_not_trashed_again(trash, gallery, outputs):
    _, picture = picture_with_sidecars(gallery, outputs)
    [item] = trash.trash([picture], None).items
    again = trash.trash([picture, item["path"]], None)
    assert again.items == []
    assert again.errors == [{"file": picture, "error": NOT_FOUND}, {"file": item["path"], "error": PATH_NOT_ALLOWED}]


def test_a_file_on_another_disk_waits_for_room_in_the_trash(trash, gallery, outputs, space, monkeypatch):
    folder, picture = picture_with_sidecars(gallery, outputs)
    monkeypatch.setattr(deleted_module, "on_same_disk", lambda a, b: False)
    space["free"] = (1 << 20) + 10
    result = trash.trash([picture], None)
    assert result.items == []
    [error] = result.errors
    assert error["error"].startswith(DISK_CANNOT_TAKE)
    assert sorted(os.listdir(folder)) == ["a.png", "a.png.thumb.png", "a.txt"]
    assert os.listdir(trash.layout.trash) == []
    with trash.db.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM trashed_files").fetchone()[0] == 0


def test_a_file_on_another_disk_is_copied_with_its_time(trash, gallery, outputs, monkeypatch):
    _, picture = picture_with_sidecars(gallery, outputs)
    mtime = os.stat(picture).st_mtime_ns
    real_link = os.link

    def link(src, dst, *args, **kwargs):
        if not os.path.basename(src).startswith(".enso-"):
            raise OSError(errno.EXDEV, "Invalid cross-device link")
        return real_link(src, dst, *args, **kwargs)

    monkeypatch.setattr(os, "link", link)
    [item] = trash.trash([picture], None).items
    assert os.stat(item["path"]).st_mtime_ns == mtime
    assert not os.path.exists(picture)


def test_restore_puts_the_file_and_its_sidecars_back_and_the_rows_follow(trash, gallery, outputs, layout):
    folder, picture = picture_with_sidecars(gallery, outputs)
    [item] = trash.trash([picture], None).items
    result = trash.restore([item["id"]])
    assert result.errors == []
    assert result.items == [{"id": item["id"], "path": picture, "name": "a.png", "renamed": False, "left": []}]
    assert sorted(os.listdir(folder)) == ["a.png", "a.png.thumb.png", "a.txt"]
    assert outputs.paths == {"a-png": os.path.realpath(picture), "a-thumb": os.path.realpath(os.path.join(folder, "a.png.thumb.png"))}
    assert row_of(trash, item["id"]) is None
    assert held_outputs(trash) == {}
    assert not os.path.exists(layout.item_dir(item["id"]))


def test_restore_beside_a_newer_file_takes_a_restored_name_for_every_sidecar(trash, gallery, outputs):
    folder, picture = picture_with_sidecars(gallery, outputs)
    [item] = trash.trash([picture], None).items
    write(folder, "a.png", b"a newer picture", age=0)
    [restored] = trash.restore([item["id"]]).items
    assert restored["name"] == "a (restored).png"
    assert restored["renamed"]
    assert sorted(os.listdir(folder)) == ["a (restored).png", "a (restored).png.thumb.png", "a (restored).txt", "a.png"]
    assert outputs.paths["a-thumb"] == os.path.realpath(os.path.join(folder, "a (restored).png.thumb.png"))


def test_a_sidecar_name_taken_alone_also_moves_the_stem(trash, gallery, outputs):
    folder, picture = picture_with_sidecars(gallery, outputs)
    [item] = trash.trash([picture], None).items
    write(folder, "a.txt", b"another job's infotext")
    [restored] = trash.restore([item["id"]]).items
    assert restored["name"] == "a (restored).png"
    with open(os.path.join(folder, "a.txt"), "rb") as f:
        assert f.read() == b"another job's infotext"


def test_restore_recreates_a_removed_folder_or_lands_in_a_chosen_one(trash, gallery, outputs):
    folder, picture = picture_with_sidecars(gallery, outputs)
    second = write(folder, "b.png")
    [first, other] = sorted(trash.trash([picture, second], None).items, key=lambda item: item["name"])
    os.rmdir(folder)
    trash.restore([first["id"]])
    assert os.path.isfile(picture)
    chosen = os.path.join(gallery, "kept")
    os.makedirs(chosen)
    [restored] = trash.restore([other["id"]], chosen).items
    assert restored["path"] == os.path.join(os.path.realpath(chosen), "b.png")


def test_restore_outside_the_gallery_is_refused_and_the_file_stays_in_the_trash(trash, gallery, outputs, root):
    _, picture = picture_with_sidecars(gallery, outputs)
    [item] = trash.trash([picture], None).items
    result = trash.restore([item["id"]], os.path.join(root, "elsewhere"))
    assert result.errors == [{"id": item["id"], "name": "a.png", "error": FOLDER_LEFT_GALLERY}]
    assert row_of(trash, item["id"])["state"] == "trashed"
    assert os.path.isfile(item["path"])


def test_a_sidecar_that_cannot_come_back_stays_in_a_folder_without_its_manifest(trash, gallery, outputs, layout, clock, monkeypatch):
    _, picture = picture_with_sidecars(gallery, outputs)
    [item] = trash.trash([picture], None).items
    real_place = deleted_module.place

    def place(src, dst, part=None):
        if src.endswith(".txt"):
            raise OSError(errno.EIO, "Input/output error")
        return real_place(src, dst, part)

    monkeypatch.setattr(deleted_module, "place", place)
    [restored] = trash.restore([item["id"]]).items
    assert restored["left"] == ["a.txt"]
    assert row_of(trash, item["id"]) is None
    inside = layout.item_dir(item["id"])
    assert os.listdir(inside) == ["a.txt"]
    assert trash.sweep(clock.now, 7) == 0
    assert trash.strays == 1
    then = clock.now / 1000 - 8 * 24 * 3600
    os.utime(inside, (then, then))
    assert trash.sweep(clock.now, 7) == 1
    assert not os.path.exists(inside)


def test_delete_and_empty_take_trashed_files_alone_through_gone(trash, gallery, outputs, layout, clock):
    folder, picture = picture_with_sidecars(gallery, outputs)
    second = write(folder, "b.png")
    items = {item["name"]: item for item in trash.trash([picture, second], None).items}
    with trash.db.write() as w:
        w.conn.execute("UPDATE trashed_files SET state = 'restoring' WHERE id = ?", (items["b.png"]["id"],))
    freed = trash.delete([items["a.png"]["id"], items["b.png"]["id"], "0123456789abcdef"])
    assert freed.ids == [items["a.png"]["id"]]
    assert freed.bytes == 9 + 8 + 5
    assert not os.path.exists(layout.item_dir(items["a.png"]["id"]))
    assert os.listdir(layout.gone) == []
    assert trash.outputs_map().gone == {"a-png": clock.now, "a-thumb": clock.now}
    assert os.path.isfile(items["b.png"]["path"])


def test_empty_leaves_what_was_trashed_after_the_list_was_read(trash, gallery, outputs, clock):
    folder, picture = picture_with_sidecars(gallery, outputs)
    [before] = trash.trash([picture], None).items
    as_of = trash.list().as_of
    clock.advance(1000)
    [after] = trash.trash([write(folder, "b.png")], None).items
    assert trash.empty(as_of).ids == [before["id"]]
    assert [item["id"] for item in trash.list().items] == [after["id"]]


def test_expiry_follows_the_retention_clock(trash, gallery, outputs, clock):
    folder, picture = picture_with_sidecars(gallery, outputs)
    [item] = trash.trash([picture], None).items
    [moving] = trash.trash([write(folder, "b.png")], None).items
    with trash.db.write() as w:
        w.conn.execute("UPDATE trashed_files SET clock_at = ? WHERE id = ?", (clock.now + DAY_MS, item["id"]))
        w.conn.execute("UPDATE trashed_files SET state = 'moving' WHERE id = ?", (moving["id"],))
    clock.advance(7 * DAY_MS + 1)
    assert trash.expire(clock.now, 7) == []
    clock.advance(DAY_MS)
    assert trash.expire(clock.now, 7) == [item["id"]]
    assert row_of(trash, moving["id"]) is not None


def test_a_lost_file_goes_its_trash_days_after_it_was_lost(trash, gallery, outputs, clock):
    _, picture = picture_with_sidecars(gallery, outputs)
    [item] = trash.trash([picture], None).items
    os.remove(item["path"])
    clock.advance(6 * DAY_MS)
    assert trash.reconcile().lost == 1
    assert trash.list().items[0]["lost"]
    clock.advance(2 * DAY_MS)
    assert trash.expire(clock.now, 7) == []
    clock.advance(6 * DAY_MS)
    assert trash.expire(clock.now, 7) == [item["id"]]


def test_deleted_outputs_are_remembered_for_the_hour(trash, gallery, outputs, clock):
    _, picture = picture_with_sidecars(gallery, outputs)
    [item] = trash.trash([picture], None).items
    assert trash.outputs_map().trashed == {"a-png": (item["id"], item["expires_at"]), "a-thumb": (item["id"], item["expires_at"])}
    trash.delete([item["id"]])
    assert trash.outputs_map().trashed == {}
    clock.advance(GONE_KEPT_MS + 1)
    trash.expire(clock.now, 7)
    assert trash.outputs_map().gone == {}


def test_relief_deletes_the_oldest_until_the_reserve_would_hold(trash, gallery, outputs, clock):
    folder = os.path.join(gallery, "text")
    [old] = trash.trash([write(folder, "a.png", b"x" * 100)], None).items
    clock.advance(1000)
    [new] = trash.trash([write(folder, "b.png", b"x" * 200)], None).items
    assert trash.relieve(free=100, reserve=50) == []
    assert trash.relieve(free=0, reserve=50) == [old["id"]]
    assert row_of(trash, new["id"]) is not None


def test_holds_path_accepts_the_files_of_an_item_and_nothing_else(trash, gallery, outputs, layout):
    folder, picture = picture_with_sidecars(gallery, outputs)
    [item] = trash.trash([picture], None).items
    inside = layout.item_dir(item["id"])
    assert trash.holds_path(item["path"])
    assert trash.holds_path(os.path.join(inside, "a.txt"))
    assert not trash.holds_path(os.path.join(inside, MANIFEST))
    assert not trash.holds_path(os.path.join(inside, "other.png"))
    assert not trash.holds_path(os.path.join(layout.trash, "0123456789abcdef", "a.png"))
    assert not trash.holds_path(os.path.join(folder, "a.png"))


def test_an_output_registered_after_its_file_went_finds_it_in_the_trash(trash, gallery, outputs):
    folder, picture = picture_with_sidecars(gallery, outputs)
    [item] = trash.trash([picture], None).items
    assert trash.holder_of(picture) == (item["id"], item["path"])
    assert trash.holder_of(os.path.join(folder, "a.txt"))[0] == item["id"]
    trash.attach("late", item["id"], "a.png")
    assert held_outputs(trash)["late"] == item["id"]
    write(folder, "a.png", b"a new picture", age=0)
    assert trash.holder_of(picture) is None


def insert_row(trash: DeletedFiles, item_id: str, state: str, folder: str, name: str, companions=(), restore_to=None, size=9, mtime=0) -> None:
    with trash.db.write() as w:
        w.conn.execute(
            "INSERT INTO trashed_files (id, state, name, folder, companions, kind, size, bytes, mtime, trashed_at, restore_to) VALUES (?, ?, ?, ?, ?, 'image', ?, ?, ?, 0, ?)",
            (item_id, state, name, os.path.realpath(folder), json.dumps(list(companions)), size, size, mtime, restore_to),
        )


def mtime_of(path: str) -> int:
    return os.stat(path).st_mtime_ns // 1_000_000


def test_a_moving_row_whose_file_arrived_is_settled_in_the_trash(trash, gallery, outputs, layout):
    folder, picture = picture_with_sidecars(gallery, outputs)
    item_id = "00000000000000aa"
    insert_row(trash, item_id, "moving", folder, "a.png", ["a.txt", "a.png.thumb.png"], mtime=mtime_of(picture))
    trash.attach("a-png", item_id, "a.png")
    inside = layout.item_dir(item_id)
    os.makedirs(inside)
    os.rename(picture, os.path.join(inside, "a.png"))
    os.link(os.path.join(folder, "a.txt"), os.path.join(inside, "a.txt"))
    result = trash.reconcile()
    assert result.trashed == 1
    row = row_of(trash, item_id)
    assert row["state"] == "trashed"
    assert json.loads(row["companions"]) == ["a.txt"]
    assert sorted(os.listdir(folder)) == ["a.png.thumb.png"]
    assert outputs.paths["a-png"] == os.path.realpath(os.path.join(inside, "a.png"))
    assert os.path.isfile(os.path.join(inside, MANIFEST))


def test_a_moving_row_whose_file_never_left_is_dropped(trash, gallery, outputs, layout):
    folder, picture = picture_with_sidecars(gallery, outputs)
    item_id = "00000000000000bb"
    insert_row(trash, item_id, "moving", folder, "a.png", mtime=mtime_of(picture))
    os.makedirs(layout.item_dir(item_id))
    write(layout.item_dir(item_id), f".enso-{item_id}.part", b"half")
    assert trash.reconcile().dropped == 1
    assert row_of(trash, item_id) is None
    assert not os.path.exists(layout.item_dir(item_id))
    assert os.path.isfile(picture)


def test_a_moving_row_whose_file_is_nowhere_is_lost(trash, gallery):
    insert_row(trash, "00000000000000cc", "moving", os.path.join(gallery, "text"), "gone.png")
    assert trash.reconcile().lost == 1
    assert row_of(trash, "00000000000000cc")["lost_at"] is not None


def test_a_restore_whose_file_arrived_is_finished(trash, gallery, outputs, layout):
    folder, picture = picture_with_sidecars(gallery, outputs)
    [item] = trash.trash([picture], None).items
    inside = layout.item_dir(item["id"])
    target = os.path.join(folder, "a (restored).png")
    with trash.db.write() as w:
        w.conn.execute("UPDATE trashed_files SET state = 'restoring', restore_to = ? WHERE id = ?", (target, item["id"]))
    os.rename(os.path.join(inside, "a.png"), target)
    write(folder, f".enso-{item['id']}.part", b"half")
    assert trash.reconcile().restored == 1
    assert sorted(os.listdir(folder)) == ["a (restored).png", "a (restored).png.thumb.png", "a (restored).txt"]
    assert outputs.paths["a-png"] == os.path.realpath(target)
    assert row_of(trash, item["id"]) is None


def test_a_restore_whose_file_never_left_goes_back_to_the_trash_whatever_sits_at_its_old_name(trash, gallery, outputs):
    folder, picture = picture_with_sidecars(gallery, outputs)
    [item] = trash.trash([picture], None).items
    write(folder, "a.png", b"a newer picture", age=0)
    with trash.db.write() as w:
        w.conn.execute("UPDATE trashed_files SET state = 'restoring', restore_to = ? WHERE id = ?", (os.path.join(folder, "a (restored).png"), item["id"]))
    assert trash.reconcile().returned == 1
    row = row_of(trash, item["id"])
    assert (row["state"], row["restore_to"]) == ("trashed", None)
    with open(picture, "rb") as f:
        assert f.read() == b"a newer picture"


def test_a_lost_file_that_came_back_is_found(trash, gallery, outputs):
    _, picture = picture_with_sidecars(gallery, outputs)
    [item] = trash.trash([picture], None).items
    os.rename(item["path"], item["path"] + ".away")
    trash.reconcile()
    os.rename(item["path"] + ".away", item["path"])
    assert trash.reconcile().found == 1
    assert row_of(trash, item["id"])["lost_at"] is None


def test_a_pass_marks_a_file_gone_from_its_folder_lost_and_clears_the_mark_when_it_is_back(trash, gallery, outputs):
    _, picture = picture_with_sidecars(gallery, outputs)
    [item] = trash.trash([picture], None).items
    os.rename(item["path"], item["path"] + ".away")
    assert trash.check() == [item["id"]]
    assert trash.list().items[0]["lost"]
    assert trash.check() == []
    os.rename(item["path"] + ".away", item["path"])
    assert trash.check() == [item["id"]]
    assert row_of(trash, item["id"])["lost_at"] is None


def test_a_pass_leaves_a_file_a_request_is_moving_alone(trash, gallery, outputs):
    _, picture = picture_with_sidecars(gallery, outputs)
    [item] = trash.trash([picture], None).items
    os.rename(item["path"], item["path"] + ".away")
    with trash.holding([item["id"]]):
        assert trash.check() == []
    insert_row(trash, "00000000000000aa", "restoring", gallery, "b.png")
    assert trash.check() == [item["id"]]
    assert row_of(trash, "00000000000000aa")["lost_at"] is None


def test_a_row_that_left_the_trash_after_it_was_read_is_not_marked(trash, gallery, outputs):
    _, picture = picture_with_sidecars(gallery, outputs)
    [item] = trash.trash([picture], None).items
    [read] = trash.rows([item["id"]]).values()
    with trash.db.write() as w:
        w.conn.execute("UPDATE trashed_files SET state = 'restoring' WHERE id = ?", (item["id"],))
    os.remove(item["path"])
    assert not trash.check_present(read, Reconciled())
    assert row_of(trash, item["id"])["lost_at"] is None


def test_a_folder_without_a_row_comes_back_from_its_manifest(trash, gallery, outputs, layout, clock):
    _, picture = picture_with_sidecars(gallery, outputs)
    [item] = trash.trash([picture], None).items
    with trash.db.write() as w:
        w.conn.execute("DELETE FROM trashed_files WHERE id = ?", (item["id"],))
    stray = os.path.join(layout.trash, "not-ours")
    os.makedirs(stray)
    write(layout.gone, "leftover", b"x")
    result = trash.reconcile()
    assert (result.adopted, result.strays) == (1, 1)
    assert os.listdir(layout.gone) == []
    assert row_of(trash, item["id"])["state"] == "trashed"
    assert held_outputs(trash) == {"a-png": item["id"], "a-thumb": item["id"]}
    then = clock.now / 1000 - 8 * 24 * 3600
    os.utime(stray, (then, then))
    assert trash.sweep(clock.now, 7) == 1
    assert not os.path.exists(stray)


def test_a_restore_of_what_is_not_in_the_trash_says_so(trash):
    assert trash.restore(["0123456789abcdef"]).errors == [{"id": "0123456789abcdef", "name": "", "error": NOT_IN_TRASH}]
