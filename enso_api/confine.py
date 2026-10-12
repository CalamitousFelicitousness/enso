"""Path confinement: the output folders file routes serve and outputs are registered under, and the Gallery's folders.

Lives outside routes.py so job_queue can confine paths at registration time
without importing the route module.
"""

import os
from collections import Counter
from collections.abc import Callable, Iterable

# Specific outdirs resolve against outdir_samples (or outdir_grids for grid
# variants), mirroring how modules.paths targets them at save time. The cloud
# outdirs are absolute-by-default but resolve the same way when relative.
OUTPUT_SPECIFIC_ATTRS = (
    "outdir_video",
    "outdir_txt2img_samples",
    "outdir_img2img_samples",
    "outdir_control_samples",
    "outdir_extras_samples",
    "outdir_cloud_image",
    "outdir_cloud_video",
)

# The folders the Gallery lists beside browser_folders, each resolved against outdir_samples or outdir_grids
GALLERY_FOLDERS = (
    "outdir_samples",
    "outdir_txt2img_samples",
    "outdir_img2img_samples",
    "outdir_control_samples",
    "outdir_extras_samples",
    "outdir_save",
    "outdir_video",
    "outdir_init_images",
    "outdir_grids",
    "outdir_txt2img_grids",
    "outdir_img2img_grids",
    "outdir_control_grids",
)

VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".avi", ".mkv", ".flv", ".wmv", ".m4v"}
# What the Gallery lists, mirrored by the client's MEDIA_EXTENSIONS
GALLERY_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif", ".avif"} | VIDEO_EXTENSIONS


def allowed_output_roots() -> list[str]:
    """Absolute roots a served or registered output path may live under.

    Roots are resolved with the same resolve_output_path the save pipeline
    uses, and any still-relative result is anchored to data_path the way
    startup fix_path anchors the options themselves - never to the process
    CWD.
    """
    from modules import shared
    from modules.paths import data_path, resolve_output_path

    from enso_api.temp_store import get_staging_dir

    base_samples = getattr(shared.opts, "outdir_samples", None)
    base_grids = getattr(shared.opts, "outdir_grids", None)
    roots: set[str] = set()

    def add(value: str) -> None:
        if not os.path.isabs(value):
            value = os.path.join(data_path, value)
        roots.add(os.path.realpath(value))

    for base in (base_samples, base_grids):
        if base:
            add(base)
    for attr in OUTPUT_SPECIFIC_ATTRS:
        value = getattr(shared.opts, attr, None)
        if not value:
            continue
        base = base_grids if "grid" in attr else base_samples
        add(resolve_output_path(base, value) if base else value)
    staging = get_staging_dir()
    if staging:
        add(staging)
    return sorted(roots)


def is_confined_to(path: str, allowed_roots) -> bool:
    """Whether `path` resolves inside one of `allowed_roots`.

    Compared with commonpath, not a string prefix: a raw startswith accepts
    the sibling `/outputs-evil` for root `/outputs`. commonpath matches whole
    components, keeps `path == root` valid, and realpath strips trailing
    separators. ValueError means the pair is not comparable (mixed
    absolute/relative), which is never confined.
    """
    path = os.path.realpath(path)
    for root in allowed_roots:
        root = os.path.realpath(root)
        try:
            if os.path.commonpath([path, root]) == root:
                return True
        except ValueError:
            continue
    return False


def confined_to_outputs(file_path: str) -> bool:
    """True when `file_path` resolves inside the allowed output roots.

    An empty root set (options unavailable) confines nothing and allows
    everything, preserving the historical behavior of the file routes.
    """
    allowed = allowed_output_roots()
    if not allowed:
        return True
    return is_confined_to(file_path, allowed)


def confine_or_403(file_path: str) -> None:
    """Raise 403 unless `file_path` is confined to the allowed output roots.

    Centralised so any ref-style file route picks up the same allow-list
    (cloud video thumbnail subroute, future audio routes, etc.) without
    duplicating the attr list.
    """
    from fastapi import HTTPException

    if not confined_to_outputs(file_path):
        raise HTTPException(status_code=403, detail="Access denied")


def reference_folder() -> str:
    """SD.Next's reference set, resolved as SD.Next resolves it: under its working folder, not the data folder."""
    return os.path.abspath(os.path.realpath(os.path.join("models", "Reference")))


def get_allowed_roots() -> set[str]:
    """Every folder the Gallery lists, resolved: the output folders, browser_folders and models/Reference."""
    from modules import shared
    from modules.paths import resolve_output_path

    roots = set()
    base_samples = shared.opts.outdir_samples
    base_grids = shared.opts.outdir_grids
    if base_samples:
        roots.add(os.path.abspath(os.path.realpath(base_samples)))
    if base_grids:
        roots.add(os.path.abspath(os.path.realpath(base_grids)))
    for opt_key in GALLERY_FOLDERS:
        val = getattr(shared.opts, opt_key, None)
        if val:
            base = base_grids if "grid" in opt_key else base_samples
            resolved = resolve_output_path(base, val) if base else val
            roots.add(os.path.abspath(os.path.realpath(resolved)))
    for f in shared.opts.browser_folders.split(","):
        f = f.strip()
        if f:
            roots.add(os.path.abspath(os.path.realpath(f)))
    roots.add(reference_folder())
    return roots


def protected_roots() -> list[tuple[str, str]]:
    """Folders the Gallery never removes files from or moves files into, resolved, each with the reason it gives:
    the reference set, then the models folder, every folder option of SD.Next's System Paths, and the folder that holds
    several of those options unless it holds an output folder too."""
    from modules import paths, shared

    from enso_api.media.companions import MODEL_FOLDERS_KEPT, REFERENCE_KEPT

    def resolve(value: str) -> str:
        return os.path.realpath(value if os.path.isabs(value) else os.path.join(paths.data_path, value))

    roots = [(reference_folder(), REFERENCE_KEPT), (resolve(paths.models_path), MODEL_FOLDERS_KEPT)]
    folders: list[str] = []
    for key, info in shared.opts.data_labels.items():
        section = getattr(info, "section", None) or ()
        # Additional allowed folders and the temporary folder hold user files, not models
        if section[:1] != ("system-paths",) or not getattr(info, "folder", False) or key in ("allowed_paths", "temp_dir"):
            continue
        value = getattr(shared.opts, key, None)
        if isinstance(value, str) and value.strip():
            folders.append(resolve(value.strip()))
    roots += [(folder, MODEL_FOLDERS_KEPT) for folder in folders]
    # Model folders set one by one under a shared parent leave that parent's other subfolders unnamed
    outputs = allowed_output_roots()
    for parent, count in Counter(os.path.dirname(folder) for folder in folders).items():
        if count > 1 and not any(is_confined_to(output, (parent,)) for output in outputs):
            roots.append((parent, MODEL_FOLDERS_KEPT))
    return list(dict.fromkeys(roots))


def outside_media_store(path: str) -> bool:
    """False for the media store's root and anything under it, which the Gallery never lists or opens; by name, so a walk stays cheap."""
    from enso_api.media import boot

    hint = boot.state.hint
    return hint is None or not hint.contains(path)


def allowed_gallery_path(path: str, roots: Iterable[str], store_root: str | None) -> bool:
    """Whether `path`, symlinks resolved, lies inside one of the Gallery's roots and outside the media store's."""
    resolved = os.path.realpath(path)
    if store_root is not None and is_confined_to(resolved, (store_root,)):
        return False
    return is_confined_to(resolved, roots)


def is_allowed_path(filepath: str) -> bool:
    """Whether the Gallery may open `filepath`."""
    from enso_api.media import boot

    hint = boot.state.hint
    return allowed_gallery_path(filepath, get_allowed_roots(), hint.root if hint is not None else None)


def gallery_folders() -> list[dict]:
    """The folders the Gallery lists, each with its label and why the Gallery keeps its files, when it does: the output
    folders, browser_folders and the reference set."""
    from modules import shared
    from modules.paths import resolve_output_path

    from enso_api.media.companions import protected_reason

    def folder(path: str, label: str | None = None) -> dict:
        return {"path": path, "label": label if label is not None else os.path.basename(path) or path}

    base_samples = shared.opts.outdir_samples
    base_grids = shared.opts.outdir_grids
    folders = []
    if base_samples:
        folders.append(folder(base_samples, os.path.basename(base_samples.rstrip("/\\"))))
    if base_grids and base_grids != base_samples:
        folders.append(folder(base_grids, os.path.basename(base_grids.rstrip("/\\"))))
    # The specific folders are labelled by their setting's value, such as outputs/text
    for attr in GALLERY_FOLDERS:
        if attr in ("outdir_samples", "outdir_grids"):
            continue
        value = getattr(shared.opts, attr, "")
        base = base_grids if "grid" in attr else base_samples
        folders.append(folder(resolve_output_path(base, value), value))
    folders.extend(folder(f.strip()) for f in shared.opts.browser_folders.split(",") if f.strip())
    folders.append(folder(os.path.join("models", "Reference"), "Reference"))
    protected = protected_roots()
    unique: dict[str, dict] = {}
    for entry in folders:
        path = entry["path"].strip()
        if path and path not in unique and os.path.isdir(path):
            unique[path] = {**entry, "kept": protected_reason(os.path.realpath(path), protected)}
    return list(unique.values())


def label_in(real: str, folders: Iterable[tuple[str, str]]) -> str | None:
    """How the Gallery names a resolved folder: the label of the deepest listed folder holding it and the rest of its path."""
    best: tuple[str, str] | None = None
    for root, label in folders:
        if (real == root or real.startswith(root.rstrip(os.sep) + os.sep)) and (best is None or len(root) > len(best[0])):
            best = (root, label)
    if best is None:
        return None
    rest = os.path.relpath(real, best[0])
    return best[1] if rest == "." else f"{best[1].rstrip('/')}/{rest.replace(os.sep, '/')}"


def folder_labeller():
    """A function naming folders as the Gallery does, over the folders it lists now; a folder it no longer lists keeps its path."""
    folders = [(os.path.realpath(entry["path"]), entry["label"]) for entry in gallery_folders()]
    return lambda folder: label_in(os.path.realpath(folder), folders) or folder


def readable_gallery_path_in(path: str, roots: Iterable[str], store_root: str | None, holds: Callable[[str], bool]) -> bool:
    """Whether the Gallery may read `path`: a file it lists, or a file the trash holds."""
    return allowed_gallery_path(path, roots, store_root) or holds(path)


def is_readable_path(filepath: str) -> bool:
    """Whether the Gallery's read routes may serve `filepath`; its write routes keep is_allowed_path."""
    from enso_api.media import boot

    hint = boot.state.hint
    deleted = boot.state.deleted
    return readable_gallery_path_in(filepath, get_allowed_roots(), hint.root if hint is not None else None, deleted.holds_path if deleted is not None else lambda path: False)
