import os

from enso_api.confine import allowed_gallery_path


def make(*parts: str) -> str:
    path = os.path.join(*parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"x")
    return path


def test_a_file_under_a_root_is_allowed(root):
    gallery = os.path.join(root, "outputs")
    assert allowed_gallery_path(make(gallery, "text", "a.png"), [gallery], None)


def test_a_step_out_of_the_root_is_refused(root):
    gallery = os.path.join(root, "outputs")
    make(root, "secret.png")
    os.makedirs(gallery)
    assert not allowed_gallery_path(os.path.join(gallery, "..", "secret.png"), [gallery], None)


def test_a_symlink_out_of_the_root_is_refused(root):
    gallery = os.path.join(root, "outputs")
    os.makedirs(gallery)
    link = os.path.join(gallery, "link.png")
    os.symlink(make(root, "secret.png"), link)
    assert not allowed_gallery_path(link, [gallery], None)


def test_the_media_store_inside_a_root_is_refused(root):
    gallery = os.path.join(root, "outputs")
    store_root = os.path.join(gallery, "media")
    assert not allowed_gallery_path(make(store_root, "blobs", "ab", "x.png"), [gallery], store_root)
    assert not allowed_gallery_path(store_root, [gallery], store_root)
    assert allowed_gallery_path(make(gallery, "a.png"), [gallery], store_root)


def test_an_encoded_separator_stays_a_name(root):
    gallery = os.path.join(root, "outputs")
    make(root, "secret.png")
    os.makedirs(gallery)
    encoded = os.path.join(gallery, "..%2Fsecret.png")
    assert allowed_gallery_path(encoded, [gallery], None)
    assert os.path.realpath(encoded) != os.path.realpath(os.path.join(root, "secret.png"))


def test_a_root_with_a_trailing_separator_matches_whole_names(root):
    gallery = os.path.join(root, "outputs")
    assert allowed_gallery_path(make(gallery, "a.png"), [gallery + os.sep], None)
    assert not allowed_gallery_path(make(root, "outputs-evil", "a.png"), [gallery + os.sep], None)


def test_a_trash_file_is_readable_and_nothing_else_beyond_the_roots(root):
    from enso_api.confine import readable_gallery_path_in

    gallery = os.path.join(root, "outputs")
    store_root = os.path.join(root, "media")
    held = make(store_root, "trash", "0123456789abcdef", "a.png")
    other = make(store_root, "blobs", "ab", "x.png")
    holds = lambda path: os.path.realpath(path) == os.path.realpath(held)
    assert readable_gallery_path_in(held, [gallery], store_root, holds)
    assert not readable_gallery_path_in(other, [gallery], store_root, holds)
    assert readable_gallery_path_in(make(gallery, "a.png"), [gallery], store_root, holds)


def test_a_folder_is_named_by_the_deepest_listed_folder_that_holds_it():
    from enso_api.confine import label_in

    folders = [("/data", "data"), ("/data/outputs/text", "outputs/text"), ("/data/models/Reference", "Reference")]
    assert label_in("/data/outputs/text/Qwen", folders) == "outputs/text/Qwen"
    assert label_in("/data/outputs/text", folders) == "outputs/text"
    assert label_in("/data/outputs/video", folders) == "data/outputs/video"
    assert label_in("/elsewhere", folders) is None
    assert label_in("/data-old/x", folders) is None
