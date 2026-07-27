"""Output-directory path confinement shared by file routes and output registration.

Lives outside routes.py so job_queue can confine paths at registration time
without importing the route module.
"""

import os

from fastapi import HTTPException

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


def confined_to_outputs(file_path: str) -> bool:
    """True when `file_path` resolves inside the allowed output roots.

    An empty root set (options unavailable) confines nothing and allows
    everything, preserving the historical behavior of the file routes.
    """
    try:
        from modules.api.security import is_confined_to
    except ImportError:
        from enso_api.security_stubs import is_confined_to
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
    if not confined_to_outputs(file_path):
        raise HTTPException(status_code=403, detail="Access denied")
