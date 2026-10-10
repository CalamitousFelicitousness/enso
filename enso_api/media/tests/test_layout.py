import os

import pytest

from enso_api.media.layout import Layout, probe_folder, resolve_root


def never(_path):
    raise AssertionError("the default root is not probed")


def test_empty_option_is_the_default_under_the_data_folder(root):
    resolved = resolve_root("", root, None, never)
    assert resolved.root == os.path.join(root, "data", "enso", "media")
    assert resolved.reason is None


def test_relative_option_is_under_the_data_folder(root):
    resolved = resolve_root("store", root, None, lambda path: None)
    assert resolved.root == os.path.join(root, "store")


def test_missing_and_unwritable_folders_give_a_reason(root):
    missing = resolve_root(os.path.join(root, "nowhere"), root, None, probe_folder)
    assert missing.root is None
    assert "does not exist" in missing.reason
    assert "'Media store folder'" in missing.reason
    assert not os.path.exists(os.path.join(root, "nowhere"))
    refused = resolve_root("/somewhere", root, None, lambda path: "is not writable (Permission denied)")
    assert refused.root is None
    assert refused.reason.startswith("/somewhere set by")


def test_a_changed_root_reports_the_previous_one(root):
    assert resolve_root("", root, os.path.join(root, "old"), never).previous == os.path.join(root, "old")
    same = os.path.join(root, "data", "enso", "media")
    assert resolve_root("", root, same + "\n", never).previous is None


def test_probe_accepts_a_writable_folder(root):
    assert probe_folder(root) is None
    assert os.listdir(root) == []


@pytest.mark.parametrize("digest", ["abc", "A" * 64, "a" * 63 + "/", "../" + "a" * 61, "a" * 65, 7])
def test_blob_path_refuses_what_is_not_a_hash(root, digest):
    with pytest.raises(ValueError):
        Layout(root).blob_path(digest, "png")


def test_blob_path_refuses_an_unknown_extension(root):
    with pytest.raises(ValueError):
        Layout(root).blob_path("a" * 64, "exe")
    assert Layout(root).blob_path("ab" + "c" * 62, "png") == os.path.join(root, "blobs", "ab", "ab" + "c" * 62 + ".png")


def test_contains_by_name_and_under_root_through_links(root):
    layout = Layout(os.path.join(root, "store"))
    layout.make()
    assert layout.contains(os.path.join(layout.root, "blobs", "ab"))
    assert not layout.contains(layout.root + "-other")
    link = os.path.join(root, "alias")
    os.symlink(layout.root, link)
    assert not layout.contains(os.path.join(link, "blobs"))
    assert layout.under_root(os.path.join(link, "blobs"))


def test_one_process_holds_the_root(root):
    first = Layout(root)
    second = Layout(root)
    assert first.lock()
    assert not second.lock()
    os.close(first.lock_fd)
    assert second.lock()
    os.close(second.lock_fd)
