import errno
import os
import shutil

import pytest

from enso_api.media import placement
from enso_api.media.placement import ChangedWhileMoving, folder_lock, place


def write(path: str, data: bytes = b"picture", mtime: float = 1_700_000_000.0) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    os.utime(path, (mtime, mtime))
    return path


def cross_disk(monkeypatch, code: int) -> None:
    """os.link fails from the source folder as it does across filesystems, and works within the destination."""
    real_link = os.link

    def link(src, dst, *args, **kwargs):
        if not os.path.basename(src).startswith(".enso-"):
            raise OSError(code, os.strerror(code))
        return real_link(src, dst, *args, **kwargs)

    monkeypatch.setattr(os, "link", link)


def test_one_disk_links_then_unlinks(root):
    src = write(os.path.join(root, "a", "x.png"))
    inode = os.stat(src).st_ino
    dst = os.path.join(root, "b", "x.png")
    os.makedirs(os.path.dirname(dst))
    place(src, dst)
    assert not os.path.exists(src)
    assert os.stat(dst).st_ino == inode


def test_a_taken_name_is_never_replaced(root):
    src = write(os.path.join(root, "a", "x.png"), b"new")
    dst = write(os.path.join(root, "b", "x.png"), b"old")
    with pytest.raises(FileExistsError):
        place(src, dst)
    with open(dst, "rb") as f:
        assert f.read() == b"old"
    assert os.path.exists(src)


@pytest.mark.parametrize("code", [errno.EXDEV, errno.EPERM])
def test_across_disks_copies_through_a_part_and_flushes(root, monkeypatch, code):
    cross_disk(monkeypatch, code)
    synced = []
    real_fsync = os.fsync
    monkeypatch.setattr(os, "fsync", lambda fd: (synced.append(fd), real_fsync(fd))[1])
    src = write(os.path.join(root, "a", "x.png"), b"bytes" * 1000)
    dst = os.path.join(root, "b", "x.png")
    os.makedirs(os.path.dirname(dst))
    place(src, dst)
    assert not os.path.exists(src)
    with open(dst, "rb") as f:
        assert f.read() == b"bytes" * 1000
    assert os.stat(dst).st_mtime == 1_700_000_000.0
    assert os.listdir(os.path.dirname(dst)) == ["x.png"]
    assert len(synced) == 2


def test_across_disks_a_taken_name_leaves_no_part(root, monkeypatch):
    cross_disk(monkeypatch, errno.EXDEV)
    src = write(os.path.join(root, "a", "x.png"), b"new")
    dst = write(os.path.join(root, "b", "x.png"), b"old")
    with pytest.raises(FileExistsError):
        place(src, dst)
    assert sorted(os.listdir(os.path.dirname(dst))) == ["x.png"]
    assert os.path.exists(src)


def test_a_source_that_grows_while_copied_is_not_moved(root, monkeypatch):
    cross_disk(monkeypatch, errno.EXDEV)
    src = write(os.path.join(root, "a", "x.png"), b"start")
    real_copy = shutil.copyfileobj

    def copy_and_grow(source, out, length=0):
        real_copy(source, out, length)
        with open(src, "ab") as f:
            f.write(b"more")

    monkeypatch.setattr(shutil, "copyfileobj", copy_and_grow)
    dst = os.path.join(root, "b", "x.png")
    os.makedirs(os.path.dirname(dst))
    with pytest.raises(ChangedWhileMoving):
        place(src, dst)
    assert os.listdir(os.path.dirname(dst)) == []
    assert os.path.exists(src)


def test_a_source_that_cannot_go_takes_the_new_name_back(root, monkeypatch):
    src = write(os.path.join(root, "a", "x.png"))
    dst = os.path.join(root, "b", "x.png")
    os.makedirs(os.path.dirname(dst))
    real_unlink = os.unlink

    def unlink(path, *args, **kwargs):
        if path == src:
            raise PermissionError(errno.EACCES, "Permission denied", path)
        return real_unlink(path, *args, **kwargs)

    monkeypatch.setattr(os, "unlink", unlink)
    with pytest.raises(PermissionError):
        place(src, dst)
    assert os.path.exists(src)
    assert not os.path.exists(dst)


def test_one_lock_per_folder_however_it_is_spelled(root, monkeypatch):
    monkeypatch.setattr(placement, "locks", {})
    os.makedirs(os.path.join(root, "out"))
    os.symlink(os.path.join(root, "out"), os.path.join(root, "alias"))
    with folder_lock(os.path.join(root, "out")):
        pass
    with folder_lock(os.path.join(root, "alias")):
        pass
    assert list(placement.locks) == [os.path.realpath(os.path.join(root, "out"))]
