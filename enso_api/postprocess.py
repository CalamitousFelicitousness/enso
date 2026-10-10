"""SD.Next postprocessing scripts: enumeration and the arg map for execute_process.

The runner (modules.scripts_postprocessing) takes one positional slice per
script, filled by create_args_for_run from {script name: {control: value}}.
ProcessParams mirrors that: one sub-model per script whose field names are
the control names, so the map here is mechanical for every script but the
Detailer, whose detection settings Enso carries in its per-model schema.
"""

import asyncio

from fastapi import APIRouter
from modules.logger import log

from enso_api.job_models import (
    ProcessCreateVideoParams,
    ProcessDetailerParams,
    ProcessDlssParams,
    ProcessGradingParams,
    ProcessNudenetParams,
    ProcessPixelartParams,
    ProcessRembgParams,
    ProcessSeedvrParams,
    ProcessUpscaleParams,
)
from enso_api.models import ItemPostprocessControlV2, ItemPostprocessScriptV2, ResPostprocessScriptsV2

router = APIRouter(prefix="/sdapi/v2/postprocess")

# script name -> (ProcessParams field, its model)
SCRIPTS = {
    "Upscale": ("upscale", ProcessUpscaleParams),
    "Detailer": ("detailer", ProcessDetailerParams),
    "Color Grading": ("grading", ProcessGradingParams),
    "Remove background": ("rembg", ProcessRembgParams),
    "NudeNet": ("nudenet", ProcessNudenetParams),
    "SeedVR": ("seedvr", ProcessSeedvrParams),
    "PixelArt": ("pixelart", ProcessPixelartParams),
    "nVidia DLSS": ("dlss", ProcessDlssParams),
    "Create Video": ("create_video", ProcessCreateVideoParams),
}
# scripts whose process() takes pp.video
VIDEO_SCRIPTS = {"SeedVR", "nVidia DLSS"}
# scripts that run once over the whole output set; execute_process calls the
# save itself so the file path is known before the job completes
BATCH_SCRIPTS = {"Create Video"}
# Detailer controls that ProcessDetailerParams carries inside `defaults`
DETAILER_DEFAULT_CONTROLS = {"enabled", "prompt", "negative", "steps", "strength", "resolution", "classes"}
# model field -> control name where a control name is unusable as a field
RENAMES = {"NudeNet": {"save_copy": "copy"}}

state = {"drift_logged": False}


def runner():
    from modules import scripts_manager

    postproc = scripts_manager.scripts_postproc
    if postproc is None:
        raise RuntimeError("postprocessing scripts are not loaded")
    if not postproc.ui_created:
        postproc.create_args_for_run({})
    return postproc


def typed_control_names(script_name: str) -> set[str] | None:
    entry = SCRIPTS.get(script_name)
    if entry is None:
        return None
    renames = RENAMES.get(script_name, {})
    names = {renames.get(f, f) for f in entry[1].model_fields}
    if script_name == "Detailer":
        names = (names - {"defaults", "models"}) | DETAILER_DEFAULT_CONTROLS
    return names


def log_control_drift() -> None:
    """Log, once, every control the server has that ProcessParams lacks and vice versa."""
    if state["drift_logged"]:
        return
    state["drift_logged"] = True
    for script in runner().scripts_in_preferred_order():
        controls = set(script.controls or {})
        typed = typed_control_names(script.name)
        if typed is None:
            log.warning(f'Enso: postprocessing script "{script.name}" has no typed model; its controls are unreachable from the Process tab: {", ".join(sorted(controls))}')
            continue
        missing = sorted(controls - typed)
        if missing:
            log.warning(f'Enso: postprocessing script "{script.name}" takes controls ProcessParams lacks: {", ".join(missing)}')
        stale = sorted(typed - controls)
        if stale:
            log.warning(f'Enso: ProcessParams sends "{script.name}" controls the script no longer has: {", ".join(stale)}')


def describe_control(name: str, control) -> ItemPostprocessControlV2:
    choices = getattr(control, "choices", None)
    if choices is not None:
        # gradio 3 CheckboxGroup stores (label, value) pairs; Dropdown stores values
        choices = [c[1] if isinstance(c, (list, tuple)) and len(c) == 2 else c for c in choices]
    value = getattr(control, "value", None)
    if callable(value):
        value = None

    def number(attr):
        v = getattr(control, attr, None)
        return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None

    return ItemPostprocessControlV2(
        name=name,
        label=getattr(control, "label", None) or "",
        kind=type(control).__name__.lower(),
        value=value,
        minimum=number("minimum"),
        maximum=number("maximum"),
        step=number("step"),
        choices=choices,
        multiselect=bool(getattr(control, "multiselect", False)),
        visible=bool(getattr(control, "visible", True)),
    )


def list_scripts() -> ResPostprocessScriptsV2:
    log_control_drift()
    items = []
    for script in runner().scripts_in_preferred_order():
        controls = script.controls or {}
        if isinstance(controls, (list, tuple)):
            controls = {getattr(c, "label", None) or str(i): c for i, c in enumerate(controls)}
        entry = SCRIPTS.get(script.name)
        items.append(
            ItemPostprocessScriptV2(
                name=script.name,
                field=entry[0] if entry else None,
                video=script.name in VIDEO_SCRIPTS,
                batch=script.name in BATCH_SCRIPTS,
                controls=[describe_control(name, control) for name, control in controls.items()],
            )
        )
    return ResPostprocessScriptsV2(scripts=items)


@router.get("/scripts", response_model=ResPostprocessScriptsV2, tags=["Process"])
async def get_postprocess_scripts_v2():
    """List the postprocessing scripts in the server's run order, with their controls."""
    return await asyncio.to_thread(list_scripts)


def resolve_path_ref(ref: str | None) -> str:
    """An upload ref becomes the stored file's path; anything else is returned as given."""
    if isinstance(ref, str) and ref.startswith("upload:"):
        from enso_api.media.boot import require_store

        return require_store().resolve_to_path(ref.removeprefix("upload:")) or ""
    return ref or ""


def build_script_args(params: dict) -> tuple[dict, list[dict]]:
    """Script args keyed by script name, and the merged detailer entries for the per-model patch.

    A script whose sub-model is absent gets no entry, which the runner turns
    into None args; every script treats that as disabled. On a video input
    only the video-capable scripts are sent. Stored params hold only the
    fields the client set, so each sub-model is re-validated to fill the rest:
    an enabled script gets every control, never None.
    """
    from enso_api.executors import normalize_detailer_models

    mode = params.get("mode", "image")
    args: dict = {}
    entries: list[dict] = []
    for name, (field, model) in SCRIPTS.items():
        sub = params.get(field)
        if sub is None or name in BATCH_SCRIPTS:
            continue
        if mode == "video" and name not in VIDEO_SCRIPTS:
            continue
        sub = model.model_validate(sub).model_dump()
        renames = RENAMES.get(name, {})
        sub = {renames.get(k, k): v for k, v in sub.items()}
        if name == "Detailer":
            defaults = {k: v for k, v in (sub.get("defaults") or {}).items() if v is not None}
            args[name] = {
                "enabled": True,
                "prompt": defaults.get("prompt", ""),
                "negative": defaults.get("negative", ""),
                "steps": defaults.get("steps", 10),
                "strength": defaults.get("strength", 0.3),
                "resolution": defaults.get("resolution", 1024),
                "classes": defaults.get("classes", ""),
                "sampler": sub.get("sampler", "Default"),
                "prediction": sub.get("prediction", "default"),
                "shift": sub.get("shift", 3.0),
                "cfg_scale": sub.get("cfg_scale", 6.0),
                "options": list(sub.get("options") or []),
                "seed": sub.get("seed", -1),
            }
            for entry in normalize_detailer_models(sub.get("models")):
                entries.append({**defaults, **{k: v for k, v in entry.items() if v is not None}})
        elif name == "Color Grading":
            args[name] = {**sub, "lut_cube_file": resolve_path_ref(sub.get("lut_cube_file"))}
        else:
            args[name] = dict(sub)
    return args, entries
