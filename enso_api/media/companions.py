"""Which files travel with a Gallery file, and whether the Gallery may remove or move a file at all.

Over names and stats only, with no sdnext import, so pytest runs it alone.
"""

import os
import stat
from collections.abc import Callable, Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field

from enso_api.confine import GALLERY_EXTENSIONS, VIDEO_EXTENSIONS

# The sidecars SD.Next writes beside an output: by its stem, by a video's stem alone, and by its full name
STEM_SIDECARS = (".txt", ".json", ".thumb.jpg")
VIDEO_STEM_SIDECARS = (".safetensors",)
NAME_SIDECARS = (".thumb.png",)
# SD.Next saves in place, with no temporary name, so a file changed this recently may still be being written
SAVING_SECONDS = 3.0

PATH_NOT_ALLOWED = "Path not allowed"
TAKEN = "A file with this name is already there"
NOT_FOUND = "File not found"
CANNOT_READ = "Cannot be read"
LINK = "A link, not a file"
NOT_MEDIA = "Not a picture or video"
STILL_SAVING = "Still being saved"
REFERENCE_KEPT = "The reference set is kept"
MODEL_FOLDERS_KEPT = "Model folders are kept"

Protected = Sequence[tuple[str, str]]


def is_media(name: str) -> bool:
    return os.path.splitext(name)[1].lower() in GALLERY_EXTENSIONS


def is_video(name: str) -> bool:
    return os.path.splitext(name)[1].lower() in VIDEO_EXTENSIONS


def stem_owner(names: Iterable[str]) -> str:
    """Of the pictures and videos of one stem that leave together, the one its sidecars go with: a video, else the first by name."""
    return min(names, key=lambda name: (not is_video(name), name))


def companions_of(name: str, files: Collection[str], leaving: Collection[str] = ()) -> list[str]:
    """The sidecars among a folder's regular files that go with `name`: its `<name>.thumb.png`, and its stem's `.txt`, `.json`
    and `.thumb.jpg` (a video's `.safetensors` too) once no other picture or video of the stem stays in the folder."""
    stem = os.path.splitext(name)[0]
    found = [name + suffix for suffix in NAME_SIDECARS]
    others = [other for other in files if other != name and is_media(other) and os.path.splitext(other)[0] == stem]
    if all(other in leaving for other in others) and stem_owner([name, *others]) == name:
        found += [stem + suffix for suffix in STEM_SIDECARS]
        if is_video(name):
            found += [stem + suffix for suffix in VIDEO_STEM_SIDECARS]
    return [companion for companion in found if companion != name and companion in files]


def fold_companions(names: Sequence[str], files: Collection[str]) -> list[tuple[str, list[str]]]:
    """Each requested name of one folder with the sidecars that go with it; a requested name that goes with another requested
    file joins that file's item instead of being one of its own."""
    leaving = set(names)
    items = [(name, companions_of(name, files, leaving)) for name in dict.fromkeys(names)]
    taken = {companion for _, companions in items for companion in companions}
    return [(name, companions) for name, companions in items if name not in taken]


def protected_reason(real: str, protected: Protected) -> str | None:
    """The reason of the first protected folder that holds `real`, a resolved path; the roots are resolved too."""
    for root, reason in protected:
        if real == root or real.startswith(root.rstrip(os.sep) + os.sep):
            return reason
    return None


def trashable(path: str, protected: Protected, now: float) -> str | None:
    """Why the Gallery may not remove or move `path`, or None: a link, anything but a picture or video, a file under a
    protected folder, a file changed within the last seconds, a file that is gone or cannot be read."""
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        return NOT_FOUND
    except OSError as e:
        return f"{CANNOT_READ} ({e.strerror or e})"
    if stat.S_ISLNK(st.st_mode):
        return LINK
    if not stat.S_ISREG(st.st_mode) or not is_media(path):
        return NOT_MEDIA
    reason = protected_reason(os.path.realpath(path), protected)
    if reason is not None:
        return reason
    if now - st.st_mtime < SAVING_SECONDS:
        return STILL_SAVING
    return None


def regular_files(folder: str) -> set[str]:
    """The names of a folder's regular files, links and folders left out."""
    try:
        with os.scandir(folder) as entries:
            return {entry.name for entry in entries if entry.is_file(follow_symlinks=False)}
    except OSError:
        return set()


@dataclass(frozen=True)
class Item:
    """A requested file with the sidecars that go with it, all in one folder."""

    given: str  # the file as the request spelled it
    folder: str  # its folder, resolved
    name: str
    companions: tuple[str, ...] = ()
    requested: Mapping[str, str] = field(default_factory=dict)  # companion names the request also named, with its spelling

    @property
    def path(self) -> str:
        return os.path.join(self.folder, self.name)

    def spelled(self, name: str) -> str:
        """A name of this folder as the request spells it."""
        return self.requested.get(name) or os.path.join(os.path.dirname(self.given), name)

    def asked(self) -> list[str]:
        """Every path the request named that this item carries."""
        return [self.given, *self.requested.values()]


def gather(paths: Iterable[str], allows: Callable[[str], bool], protected: Protected, now: float) -> tuple[list[Item], list[dict]]:
    """The items a Gallery request asks to remove or move, one per file with its sidecars, and an error per refused path."""
    errors: list[dict] = []
    folders: dict[str, dict[str, str]] = {}
    for given in dict.fromkeys(paths):
        reason = PATH_NOT_ALLOWED if not allows(given) else trashable(given, protected, now)
        if reason is not None:
            errors.append({"file": given, "error": reason})
            continue
        folder = os.path.realpath(os.path.dirname(os.path.abspath(given)))
        folders.setdefault(folder, {}).setdefault(os.path.basename(given), given)
    items: list[Item] = []
    for folder, names in folders.items():
        for name, companions in fold_companions(list(names), regular_files(folder)):
            requested = {companion: names[companion] for companion in companions if companion in names}
            items.append(Item(names[name], folder, name, tuple(companions), requested))
    return items, errors
