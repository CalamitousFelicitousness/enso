import os
import time

from enso_api.media.companions import (
    LINK,
    MODEL_FOLDERS_KEPT,
    NOT_FOUND,
    NOT_MEDIA,
    PATH_NOT_ALLOWED,
    REFERENCE_KEPT,
    STILL_SAVING,
    companions_of,
    fold_companions,
    gather,
    protected_reason,
    regular_files,
    trashable,
)


def touch(folder: str, *names: str, age: float = 60.0) -> list[str]:
    os.makedirs(folder, exist_ok=True)
    paths = []
    for name in names:
        path = os.path.join(folder, name)
        with open(path, "wb") as f:
            f.write(b"x")
        then = time.time() - age
        os.utime(path, (then, then))
        paths.append(path)
    return paths


def test_an_image_takes_its_stem_sidecars_and_its_name_thumb():
    files = {"cat.png", "cat.txt", "cat.json", "cat.thumb.jpg", "cat.png.thumb.png", "cat.1.txt", "cat.safetensors", "dog.txt"}
    assert sorted(companions_of("cat.png", files)) == ["cat.json", "cat.png.thumb.png", "cat.thumb.jpg", "cat.txt"]


def test_a_video_takes_its_safetensors_and_leaves_its_frames():
    files = {"clip.mp4", "clip.txt", "clip.thumb.jpg", "clip.safetensors", "clip-00001.jpg", "clip-00002.jpg"}
    assert sorted(companions_of("clip.mp4", files)) == ["clip.safetensors", "clip.thumb.jpg", "clip.txt"]


def test_a_stem_shared_with_a_picture_that_stays_keeps_its_sidecars():
    files = {"x.png", "x.mp4", "x.txt", "x.thumb.jpg", "x.safetensors", "x.png.thumb.png"}
    assert companions_of("x.png", files) == ["x.png.thumb.png"]
    assert companions_of("x.mp4", files) == []


def test_of_a_shared_stem_leaving_together_the_video_takes_the_sidecars():
    files = {"x.png", "x.mp4", "x.txt", "x.thumb.jpg", "x.safetensors"}
    leaving = {"x.png", "x.mp4"}
    assert companions_of("x.png", files, leaving) == []
    assert sorted(companions_of("x.mp4", files, leaving)) == ["x.safetensors", "x.thumb.jpg", "x.txt"]


def test_two_pictures_of_one_stem_leaving_together_give_the_sidecars_to_the_first_by_name():
    files = {"x.png", "x.jpg", "x.txt"}
    assert companions_of("x.jpg", files, files) == ["x.txt"]
    assert companions_of("x.png", files, files) == []


def test_a_requested_poster_joins_its_video_in_either_order():
    files = {"clip.mp4", "clip.thumb.jpg", "clip.txt"}
    for names in (["clip.mp4", "clip.thumb.jpg"], ["clip.thumb.jpg", "clip.mp4"]):
        assert fold_companions(names, files) == [("clip.mp4", ["clip.txt", "clip.thumb.jpg"])]


def test_a_poster_requested_alone_goes_alone():
    files = {"clip.mp4", "clip.thumb.jpg", "clip.txt"}
    assert fold_companions(["clip.thumb.jpg"], files) == [("clip.thumb.jpg", [])]


def test_regular_files_leave_out_links_and_folders(root):
    touch(root, "a.png")
    os.symlink(os.path.join(root, "a.png"), os.path.join(root, "a.txt"))
    os.makedirs(os.path.join(root, "a.json"))
    assert regular_files(root) == {"a.png"}
    assert regular_files(os.path.join(root, "missing")) == set()


def test_trashable_refuses_with_the_reason(root):
    now = time.time()
    reference = os.path.join(root, "models", "Reference")
    vae = os.path.join(root, "models", "VAE")
    protected = [(reference, REFERENCE_KEPT), (os.path.join(root, "models"), MODEL_FOLDERS_KEPT)]
    [picture] = touch(os.path.join(root, "outputs"), "a.png")
    link = os.path.join(root, "outputs", "b.png")
    os.symlink(picture, link)
    [weights] = touch(os.path.join(root, "outputs"), "a.safetensors")
    [kept] = touch(reference, "ref.png")
    [preview] = touch(vae, "ae.jpeg")
    [fresh] = touch(os.path.join(root, "outputs"), "fresh.png", age=2.0)
    assert trashable(picture, protected, now) is None
    assert trashable(link, protected, now) == LINK
    assert trashable(weights, protected, now) == NOT_MEDIA
    assert trashable(os.path.join(root, "outputs"), protected, now) == NOT_MEDIA
    assert trashable(kept, protected, now) == REFERENCE_KEPT
    assert trashable(preview, protected, now) == MODEL_FOLDERS_KEPT
    assert trashable(fresh, protected, now) == STILL_SAVING
    assert trashable(os.path.join(root, "outputs", "gone.png"), protected, now) == NOT_FOUND


def test_trashable_reports_a_file_it_cannot_read(root):
    [path] = touch(os.path.join(root, "locked"), "a.png")
    os.chmod(os.path.join(root, "locked"), 0)
    try:
        reason = trashable(path, [], time.time())
    finally:
        os.chmod(os.path.join(root, "locked"), 0o755)
    assert reason is not None
    assert reason.startswith("Cannot be read (")


def test_protected_reason_matches_whole_names():
    protected = [("/data/models", MODEL_FOLDERS_KEPT)]
    assert protected_reason("/data/models", protected) == MODEL_FOLDERS_KEPT
    assert protected_reason("/data/models/VAE/ae.jpeg", protected) == MODEL_FOLDERS_KEPT
    assert protected_reason("/data/models-old/a.png", protected) is None


def test_gather_folds_dedupes_and_refuses(root):
    folder = os.path.join(root, "outputs")
    clip, poster, _, picture = touch(folder, "clip.mp4", "clip.thumb.jpg", "clip.txt", "a.png")
    alias = os.path.join(root, "alias")
    os.symlink(folder, alias)
    items, errors = gather(
        [clip, poster, os.path.join(alias, "a.png"), picture, os.path.join(root, "secret.png")],
        allows=lambda path: not path.endswith("secret.png"),
        protected=[],
        now=time.time(),
    )
    assert errors == [{"file": os.path.join(root, "secret.png"), "error": PATH_NOT_ALLOWED}]
    by_name = {item.name: item for item in items}
    assert sorted(by_name) == ["a.png", "clip.mp4"]
    video = by_name["clip.mp4"]
    assert video.folder == os.path.realpath(folder)
    assert video.companions == ("clip.txt", "clip.thumb.jpg")
    assert video.asked() == [clip, poster]
    assert video.spelled("clip.txt") == os.path.join(folder, "clip.txt")
    assert video.spelled("clip.thumb.jpg") == poster
    assert by_name["a.png"].given == os.path.join(alias, "a.png")
