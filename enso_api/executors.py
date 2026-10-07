"""V2 job executors.

Each executor calls through to the same backend processing code as the
corresponding v1 endpoint.  This ensures both API versions produce
identical results:

    v2 generate  -> modules.control.run.control_run()          (same as v1 /control, /txt2img, /img2img)
    v2 process   -> modules.postprocessing.run_postprocessing() (same as v1 /process with script_args)
    v2 upscale   -> execute_process with only the Upscale script
    v2 caption   -> modules.api.caption.do_caption/openclip/tagger (same as v1 /vqa, /openclip, /tagger)
    v2 enhance   -> scripts.prompt_enhance.enhance()           (same as v1 /prompt-enhance)
    v2 detect    -> shared.detailer.predict()                  (same as v1 /detect)
    v2 preprocess-> modules.control.processors.Processor       (same as v1 /preprocess)
    v2 model-load-> modules.sd_models.reload_model_weights()   (v2-only, replaces v1 poll-based reload)
    v2 model-merge  -> modules.extras.run_modelmerger()        (v2-only, job-based merge)
    v2 model-replace-> modules.extras.run_model_modules()      (v2-only, job-based component replace)
    v2 model-save   -> modules.sd_models.save_model()          (v2-only, job-based save)
    v2 loader-load  -> modules.ui_models_load.load_model()     (v2-only, job-based component loader)
    v2 lora-extract -> modules.lora.lora_extract.make_lora()   (v2-only, job-based LoRA extraction)
    v2 hf-download  -> modules.models_hf.hf_download_model()   (v2-only, job-based HF download)
    v2 rembg     -> execute_process with only the Remove background script

Do NOT duplicate processing logic here.  If v1 has a function for it,
call that function.
"""

import inspect
import os

from modules.logger import log

# --- Detailer V2 per-model override helpers ---------------------------------
# The V2 detailer schema (DetailerMixin in job_models.py) replaces the V1 flat
# detailer_* fields with detailer_defaults + detailer_models, where each model
# entry can override any default. SD.Next's shared.detailer.restore() iterates
# models off p.detailer_models with one shared set of p.detailer_* attrs, so we
# temporarily monkey-patch shared.detailer.restore to drive that loop ourselves
# with per-iteration p attribute swapping.

DETAILER_OVERRIDE_FIELDS = (
    # Mirrors p.detailer_* attributes that the detailer restore pass reads via
    # either direct p.detailer_X access or detailer_opt(p, 'detailer_X').
    # Patching any of these between iterations sticks for that iteration's
    # detect/inpaint pass. Note: cfg_scale is intentionally excluded - there is
    # no p.detailer_cfg_scale; restore() only injects it via the colon-string
    # args.update path which V2 escapes by design.
    "strength",
    "steps",
    "resolution",
    "padding",
    "blur",
    "conf",
    "iou",
    "min_size",
    "max_size",
    "max",
    "sigma_adjust",
    "sigma_adjust_max",
    "segmentation",
    "include_detections",
    "merge",
    "sort",
    "prompt",
    "negative",
    "classes",
    "augment",
)


def normalize_detailer_models(entries):
    """Coerce mixed string|dict entries from the wire into list[dict]."""
    out = []
    for entry in entries or []:
        if isinstance(entry, str):
            out.append({"name": entry})
        elif isinstance(entry, dict) and entry.get("name"):
            out.append(entry)
    return out


def apply_detailer_defaults(p, defaults):
    """Set base p.detailer_* attributes from the V2 defaults block.

    Only fields actually present (not None) are set; the rest keep
    SD.Next's built-in default. Mutates p in place.
    """
    if not defaults:
        return
    for k, v in defaults.items():
        if v is not None and k in DETAILER_OVERRIDE_FIELDS:
            setattr(p, f"detailer_{k}", v)


def install_detailer_per_model_patch(model_entries):
    """Replace shared.detailer.restore with a per-model loop wrapper.

    The wrapper iterates ``model_entries``, snapshots p.detailer_*,
    patches with this entry's overrides (or restores defaults for unset
    fields), sets p.detailer_models to a single-element list, resets
    p.detailer_active so the per-model cap doesn't saturate, calls the
    real restore, then reverts p. Returns a ``restore()`` callable to
    undo the monkey-patch and restore shared.opts state.

    Also temporarily blanks shared.opts.data['detailer_args'] because
    Detailer.restore reads it before falling through to p.detailer_models
    (modules/detailer/detailer.py); leaving it set would override our
    per-model intent. This is the exact failure mode that prompted V2.

    Caller is responsible for invoking ``restore()`` in a finally block.
    Safe under serialized execution (the job queue holds
    modules.call_queue.queue_lock).
    """
    from modules import shared

    original_detail = shared.detailer.restore
    saved_args = shared.opts.data.get("detailer_args", "")
    shared.opts.data["detailer_args"] = ""
    entries = list(model_entries or [])

    def patched(sample, p_inner):
        if not entries:
            return sample
        # Detailer.restore returns a list -- [image_array] or
        # [image_array, annotation_overlay] when include_detections is set
        # (modules/detailer/detailer.py). The next iteration must receive the
        # bare image array, so we unwrap between calls. Annotations from later
        # iterations supersede earlier ones (process_samples only inspects
        # sample[1], so we can only surface one).
        last_extras: list = []
        for entry in entries:
            saved = {k: getattr(p_inner, f"detailer_{k}", None) for k in DETAILER_OVERRIDE_FIELDS}
            saved_models = list(getattr(p_inner, "detailer_models", []) or [])
            saved_active = getattr(p_inner, "detailer_active", 0)
            try:
                for k in DETAILER_OVERRIDE_FIELDS:
                    if entry.get(k) is not None:
                        setattr(p_inner, f"detailer_{k}", entry[k])
                p_inner.detailer_models = [entry["name"]]
                p_inner.detailer_active = 0
                result = original_detail(sample, p_inner)
            finally:
                for k, v in saved.items():
                    setattr(p_inner, f"detailer_{k}", v)
                p_inner.detailer_models = saved_models
                p_inner.detailer_active = saved_active
            if isinstance(result, list):
                if len(result) > 0:
                    sample = result[0]
                if len(result) > 1:
                    last_extras = list(result[1:])
            elif result is not None:
                sample = result
                last_extras = []
        # Mirror the detailer restore's list-shaped return so process_samples'
        # isinstance(sample, list) branch still picks up annotations.
        if last_extras:
            return [sample, *last_extras]
        return sample

    shared.detailer.restore = patched

    def restore():
        shared.detailer.restore = original_detail
        shared.opts.data["detailer_args"] = saved_args

    return restore


# GenerateParams fields execute_generate passes to control_run itself, or not at all
SKIP_KEYS = {"type", "inputs", "inits", "mask", "control", "ip_adapter", "save_images", "sampler_name", "script_name", "script_args", "alwayson_scripts", "extra", "priority"}
# GenerateParams fields read by Enso that control_run has no keyword for
LOCAL_KEYS = {"width", "height", "mask_blur", "inpaint_full_res", "inpaint_full_res_padding", "inpainting_mask_invert", "detailer_defaults", "live_previews"}


def unforwarded_generate_fields() -> list[str]:
    """GenerateParams fields that neither reach control_run nor are read by Enso."""
    from modules.control import run as control_run_module

    from enso_api.job_models import GenerateParams

    taken = set(inspect.signature(control_run_module.control_run).parameters)
    return sorted(set(GenerateParams.model_fields) - taken - SKIP_KEYS - LOCAL_KEYS)


# sdnext names the executors import lazily from modules every branch carries;
# a rename there would otherwise surface as a 500 on first use
SDNEXT_NAMES: dict[str, tuple[str, ...]] = {
    "modules.api.caption": ("ReqVQA", "ReqCaptionOpenCLIP", "ReqTagger", "do_caption", "do_openclip", "do_tagger", "validate_image"),
    "modules.api.helpers": ("decode_base64_to_image",),
    "modules.postprocessing": ("run_postprocessing",),
    "modules.processing_helpers": ("get_fixed_seed",),
    "modules.ui_video_vlm": ("enhance_prompt",),
    "modules.video_models.video_run": ("VideoError", "resolve_model", "run"),
}


def missing_sdnext_names() -> list[str]:
    """Entries of SDNEXT_NAMES the running sdnext does not provide, as module.name."""
    import importlib

    missing = []
    for module_name, names in SDNEXT_NAMES.items():
        try:
            module = importlib.import_module(module_name)
        except Exception as e:
            missing.append(f"{module_name} ({type(e).__name__}: {e})")
            continue
        missing.extend(f"{module_name}.{name}" for name in names if not hasattr(module, name))
    return missing


class GenerationFailed(Exception):
    """control_run ended without an image; sdnext has already logged the cause."""

    logged = True

    def __init__(self, reason: str | None):
        self.reason = reason  # control_run's own stop message, when it gave one
        self.detail = reason or "No image was generated. The Console shows the reason."
        super().__init__(self.detail)


def masked_image_short_side(params: dict, inputs: list | None, inits: list | None, mask) -> int:
    """Short side of the image sdnext blurs the mask against: the first input after resize_mode_before, else the init as sent."""
    if inputs:
        if params.get("resize_mode_before", 0):
            return min(params.get("width_before", 1024), params.get("height_before", 1024))
        return min(inputs[0].size)
    return min((inits or [mask])[0].size)


def execute_generate(params: dict, job_id: str) -> dict:
    from modules import processing_helpers, shared
    from modules.api import helpers
    from modules.control import run as control_run_module
    from modules.control.unit import Unit

    from enso_api import condition_images, control_units

    condition_images.validate(params, shared.sd_model)
    control_units.validate(params)

    # Decode base64 images
    inputs = [helpers.decode_base64_to_image(x) for x in params.get("inputs", [])] if params.get("inputs") else None
    inits = [helpers.decode_base64_to_image(x) for x in params.get("inits", [])] if params.get("inits") else None
    mask = helpers.decode_base64_to_image(params["mask"]) if params.get("mask") else None

    # Build units from control dicts
    units = []
    control_dicts = params.get("control") or []
    for u in control_dicts:
        if not isinstance(u, dict):
            continue
        unit = Unit(
            enabled=True,
            unit_type=u.get("unit_type", "controlnet"),
            model_id=u.get("model", ""),
            process_id=u.get("process", ""),
            strength=u.get("strength", 1.0),
            start=u.get("start", 0.0),
            end=u.get("end", 1.0),
        )
        unit.guess = u.get("guess", False)
        unit.factor = u.get("factor", 1.0)
        unit.attention = u.get("attention", "Attention")
        unit.fidelity = u.get("fidelity", 0.5)
        unit.query_weight = u.get("query_weight", 1.0)
        unit.adain_weight = u.get("adain_weight", 1.0)
        unit.process_params = u.get("process_params") or {}
        unit.update_choices(u.get("model", ""))
        mode = u.get("mode", "default")
        if mode != "default" and unit.choices and mode in unit.choices:
            unit.mode = mode
        elif unit.choices:
            unit.mode = unit.choices[0]
        if unit.process is not None:
            unit.process.override = None
        override_b64 = u.get("override") or u.get("image")
        if override_b64:
            unit.override = helpers.decode_base64_to_image(override_b64)
        units.append(unit)

    # Build IP adapter args
    ip_adapter_args = {}
    ip_adapter_list = [ipa for ipa in params.get("ip_adapter") or [] if isinstance(ipa, dict) and ipa.get("images")]
    if ip_adapter_list:
        images = [[helpers.decode_base64_to_image(x) for x in ipa["images"]] for ipa in ip_adapter_list]
        masks = [[helpers.decode_base64_to_image(x) for x in ipa["masks"]] if ipa.get("masks") else None for ipa in ip_adapter_list]
        ip_adapter_args = {
            "ip_adapter_names": [ipa.get("adapter", "") for ipa in ip_adapter_list],
            "ip_adapter_scales": [ipa.get("scale", 1.0) for ipa in ip_adapter_list],
            "ip_adapter_crops": [ipa.get("crop", False) for ipa in ip_adapter_list],
            "ip_adapter_starts": [ipa.get("start", 0.0) for ipa in ip_adapter_list],
            "ip_adapter_ends": [ipa.get("end", 1.0) for ipa in ip_adapter_list],
            "ip_adapter_images": images,
            "ip_adapter_masks": control_units.masks_per_adapter(masks, images),
        }

    save_images = params.get("save_images", True)
    sampler_name = params.get("sampler_name", "Default")
    sampler_index = processing_helpers.get_sampler_index(sampler_name)

    # Build args dict for control_run, only passing params it accepts
    valid_params = set(inspect.signature(control_run_module.control_run).parameters.keys())
    # control_run's own cfg_true of 0 switches off the true CFG some pipelines run by default
    run_args = {k: v for k, v in {"cfg_true": -1.0, **params}.items() if k in valid_params and k not in SKIP_KEYS}
    run_args["sampler_index"] = sampler_index
    run_args["is_generator"] = True
    run_args["inputs"] = inputs
    run_args["inits"] = inits
    run_args["mask"] = mask
    run_args["units"] = units
    if units:
        run_args["unit_type"] = units[0].type

    extra = params.get("extra", {}) or {}
    run_args["extra"] = extra

    # The V2 executor is the sole image saver: it writes each returned image
    # once (preserving the pipeline's infotext) and serves those paths. Let the
    # pipeline skip its own sample and grid saves so files are not written twice
    # to disk. Montage grids are a Gradio-UI artifact and are never returned by
    # the V2 API.
    extra_p_args = {
        "do_not_save_grid": True,
        "do_not_save_samples": True,
        **ip_adapter_args,
    }

    override_script_name = params.get("script_name")
    override_script_args = params.get("script_args", [])
    if override_script_name:
        run_args["override_script_name"] = override_script_name
        run_args["override_script_args"] = override_script_args

    # Apply masking options from request params (reset ALL opts to prevent stale values from triggering expensive operations like SAM segmentation)
    if mask is not None:
        from modules import masking

        # masking.run_mask takes the blur as a fraction of the short side of the image it masks
        mask_blur_px = params.get("mask_blur", 0)
        size = masked_image_short_side(params, inputs, inits, mask)
        masking.opts.mask_blur = round(4 * mask_blur_px / size, 3) if mask_blur_px > 0 and size > 0 else 0
        masking.opts.mask_only = params.get("inpaint_full_res", False)
        masking.opts.mask_invert = params.get("inpainting_mask_invert", 0) == 1
        masking.opts.auto_mask = "None"
        masking.opts.auto_segment = "None"
        masking.opts.mask_erode = 0
        masking.opts.mask_dilate = 0
        extra_p_args["inpaint_full_res_padding"] = params.get("inpaint_full_res_padding", 32)

    # V2 detailer: translate detailer_defaults + detailer_models entries into
    # the flat detailer_* kwargs control_run expects, then install the per-model
    # patch around the call. control_run builds p itself and forwards detailer_*
    # to the StableDiffusionProcessing constructor; the patch then reroutes the
    # shared.detailer.restore invocation inside process_samples to iterate our entries.
    detailer_defaults = params.get("detailer_defaults") or {}
    detailer_entries = normalize_detailer_models(params.get("detailer_models"))
    for k, v in detailer_defaults.items():
        if v is not None and k in DETAILER_OVERRIDE_FIELDS:
            run_args[f"detailer_{k}"] = v
    run_args["detailer_models"] = [entry["name"] for entry in detailer_entries]
    run_args["detailer_enabled"] = bool(detailer_entries) and bool(params.get("detailer_enabled", False))
    # detailer_defaults is V2-only; control_run's signature filter at line 202
    # already rejects it via the in-set check, but be explicit.
    run_args.pop("detailer_defaults", None)

    # Run generation
    detailer_restore = install_detailer_per_model_patch(detailer_entries) if run_args["detailer_enabled"] else None
    jobid = shared.state.begin("API-V2", api=True)
    try:
        control_run_module.control_set(extra_p_args)
        res = control_run_module.control_run(**run_args)

        output_images = []
        output_processed = []
        stop_message = None
        for item in res:
            if isinstance(item, str):  # control_run stopping early with its reason
                stop_message = item
                continue
            if len(item) > 0 and (isinstance(item[0], list) or item[0] is None):
                output_images += item[0] if item[0] is not None else []
            # control_run yields the processed picture before and after generation
            if len(item) > 1 and item[1] is not None and all(item[1] is not kept for kept in output_processed):
                output_processed.append(item[1])

        # Capture saved file paths BEFORE end() clears state.results
        saved_paths = list(shared.state.results) if hasattr(shared.state, "results") and shared.state.results else []
    finally:
        shared.state.end(jobid)
        if detailer_restore is not None:
            detailer_restore()

    # control_run logs a pipeline exception and returns no image instead of raising
    if not output_images:
        from enso_api.job_queue import job_queue

        if not job_queue.stopped_by_user(job_id):
            raise GenerationFailed(stop_message)

    # Collect saved file paths
    image_refs = []

    for i, img in enumerate(output_images):
        path = saved_paths[i] if i < len(saved_paths) else None
        if path and os.path.isfile(str(path)):
            path = str(path)
            ext = os.path.splitext(path)[1].lstrip(".").lower()
            image_refs.append(
                {
                    "index": i,
                    "path": path,
                    "url": f"/sdapi/v2/jobs/{job_id}/images/{i}",
                    "width": img.width if hasattr(img, "width") else 0,
                    "height": img.height if hasattr(img, "height") else 0,
                    "format": ext if ext else "png",
                    "size": os.path.getsize(path),
                }
            )
        elif img is not None:
            if save_images:
                # Fallback: save image manually if not saved by the pipeline
                from modules import images as img_module
                from modules.paths import resolve_output_path

                try:
                    output_dir = resolve_output_path(shared.opts.outdir_samples, shared.opts.outdir_img2img_samples if inputs or inits else shared.opts.outdir_txt2img_samples)
                    img_info = img.info.get("parameters") if isinstance(getattr(img, "info", None), dict) else None
                    path_info = img_module.save_image(img, output_dir, "", seed=params.get("seed", -1), prompt=params.get("prompt", ""), info=img_info)
                    if path_info and len(path_info) > 0:
                        fpath = path_info[0] if isinstance(path_info, (list, tuple)) else str(path_info)
                        if os.path.isfile(str(fpath)):
                            ext = os.path.splitext(str(fpath))[1].lstrip(".").lower()
                            image_refs.append(
                                {
                                    "index": i,
                                    "path": str(fpath),
                                    "url": f"/sdapi/v2/jobs/{job_id}/images/{i}",
                                    "width": img.width if hasattr(img, "width") else 0,
                                    "height": img.height if hasattr(img, "height") else 0,
                                    "format": ext if ext else "png",
                                    "size": os.path.getsize(str(fpath)),
                                }
                            )
                except Exception as e:
                    log.warning(f"Job {job_id}: failed to save fallback image {i}: {e}")
            else:
                # save_images=False: stage to temp dir so images are still downloadable
                from enso_api.temp_store import stage_image

                try:
                    staged = stage_image(job_id, i, img)
                    if staged:
                        image_refs.append(
                            {
                                "index": i,
                                "path": staged["path"],
                                "url": f"/sdapi/v2/jobs/{job_id}/images/{i}",
                                "width": staged["width"],
                                "height": staged["height"],
                                "format": staged["format"],
                                "size": staged["size"],
                                "temp": True,
                            }
                        )
                except Exception as e:
                    log.warning(f"Job {job_id}: failed to stage temp image {i}: {e}")

    # Save processed control images to disk and build refs
    processed_refs = []
    if output_processed:
        from modules import images as img_module
        from modules.paths import resolve_output_path

        output_dir = resolve_output_path(shared.opts.outdir_samples, shared.opts.outdir_extras_samples if hasattr(shared.opts, "outdir_extras_samples") else shared.opts.outdir_txt2img_samples)
        for pi, proc_img in enumerate(output_processed):
            try:
                path_info = img_module.save_image(proc_img, output_dir, "control-", prompt="processed")
                fpath = path_info[0] if isinstance(path_info, (list, tuple)) else str(path_info) if path_info else None
                if fpath and os.path.isfile(str(fpath)):
                    fpath = str(fpath)
                    ext = os.path.splitext(fpath)[1].lstrip(".").lower()
                    processed_refs.append(
                        {
                            "index": pi,
                            "path": fpath,
                            "url": f"/sdapi/v2/jobs/{job_id}/processed/{pi}",
                            "width": proc_img.width if hasattr(proc_img, "width") else 0,
                            "height": proc_img.height if hasattr(proc_img, "height") else 0,
                            "format": ext or "png",
                            "size": os.path.getsize(fpath),
                        }
                    )
            except Exception as e:
                log.warning(f"Job {job_id}: failed to save processed image {pi}: {e}")

    result = {"images": image_refs, "processed": processed_refs, "info": {}, "params": {k: v for k, v in params.items() if k != "type"}}
    if not save_images and image_refs:
        from enso_api.temp_store import get_staging_dir

        root = get_staging_dir()
        if root:
            result["_staging_dir"] = os.path.join(root, job_id)
    return result


def execute_upscale(params: dict, job_id: str) -> dict:
    """The pre-process wire shape: a process job running only the Upscale script."""
    return execute_process(
        {
            "mode": "image",
            "images": [params.get("image", "")],
            "save_output": True,
            "upscale": {
                "upscale_mode": params.get("resize_mode", 0),
                "upscale_by": params.get("scale", 2.0),
                "upscale_to_width": params.get("width", 0),
                "upscale_to_height": params.get("height", 0),
                "upscale_crop": params.get("crop", True),
                "upscaler_1_name": params.get("upscaler", "None"),
                "upscaler_2_name": params.get("upscaler_2", "None"),
                "upscaler_2_visibility": params.get("upscaler_2_visibility", 0.0),
            },
        },
        job_id,
    )


def execute_process(params: dict, job_id: str) -> dict:
    """SD.Next's postprocessing pipeline over one image, a batch, a server folder or a video.

    Image and batch outputs are saved here (or staged when save_output is
    false) so their paths are known; in folder mode sdnext saves into
    output_dir itself and the returned images are previews. The batch video
    is written here rather than by the Create Video script, whose save runs
    on a thread and never reports the file.
    """
    from modules import images as img_module
    from modules import postprocessing, scripts_manager, shared
    from modules import video as video_module
    from modules.api import helpers
    from modules.paths import resolve_output_path

    from enso_api.postprocess import build_script_args, log_control_drift, resolve_path_ref
    from enso_api.temp_store import get_staging_dir, stage_image
    from enso_api.video_result import build_video_ref, probe_video_file

    log_control_drift()
    mode = params.get("mode", "image")
    extras_mode = {"image": 0, "batch": 1, "folder": 2, "video": 3}[mode]
    image = None
    image_folder: list = []
    input_dir = params.get("input_dir", "") if mode == "folder" else ""
    output_dir = params.get("output_dir", "") if mode == "folder" else ""
    video_in = ""
    if mode == "image":
        image = helpers.decode_base64_to_image((params.get("images") or [""])[0])
    elif mode == "batch":
        image_folder = [helpers.decode_base64_to_image(ref) for ref in params.get("images") or []]
    elif mode == "video":
        video_in = resolve_path_ref(params.get("video"))
        if not video_in or not os.path.isfile(video_in):
            raise ValueError("execute_process: video input not found")
    save_output = params.get("save_output", True)
    create_video = params.get("create_video") if mode in ("batch", "folder") else None
    show_results = params.get("show_results", True) or create_video is not None

    script_args, detailer_entries = build_script_args(params)
    args = scripts_manager.scripts_postproc.create_args_for_run(script_args)
    restore = install_detailer_per_model_patch(detailer_entries) if detailer_entries else None
    jobid = shared.state.begin("API-V2-PROC", api=True)
    try:
        outputs, video_out, info, _params = postprocessing.run_postprocessing(
            extras_mode,
            image,
            image_folder,
            input_dir,
            output_dir,
            video_in,
            show_results,
            *args,
            save_output=(mode == "folder" and save_output),
        )
    finally:
        shared.state.end(jobid)
        if restore:
            restore()
    outputs = outputs or []

    if mode == "video":
        if not video_out or not os.path.isfile(str(video_out)):
            raise RuntimeError(f"Process: {info or 'no video produced'}")
        if os.path.realpath(str(video_out)) == os.path.realpath(video_in):
            raise RuntimeError("Process: no video-capable script ran; enable SeedVR or DLSS")
    elif mode != "folder" and not outputs:
        raise RuntimeError(f"Process: {info or 'no output produced'}")

    outpath = resolve_output_path(shared.opts.outdir_samples, shared.opts.outdir_extras_samples)
    image_refs = []
    staged = False

    def file_ref(index, fpath, img, temp=False):
        ext = os.path.splitext(fpath)[1].lstrip(".").lower()
        ref = {"index": index, "path": fpath, "url": f"/sdapi/v2/jobs/{job_id}/images/{index}", "width": img.width, "height": img.height, "format": ext or "png", "size": os.path.getsize(fpath)}
        if temp:
            ref["temp"] = True
        return ref

    for i, img in enumerate(outputs):
        if mode != "folder" and save_output:
            fpath, _txt, _exif = img_module.save_image(img, path=outpath, extension=shared.opts.samples_format, info=img.info.get("postprocessing"), grid=False, pnginfo_section_name="extras", existing_info=img.info)
            if fpath and os.path.isfile(str(fpath)):
                image_refs.append(file_ref(i, str(fpath), img))
            continue
        try:
            stage = stage_image(job_id, i, img)
        except Exception as e:
            log.warning(f"Job {job_id}: failed to stage image {i}: {e}")
            continue
        if stage:
            image_refs.append(file_ref(i, stage["path"], img, temp=True))
            staged = True

    video_refs = []
    if mode == "video":
        video_refs.append(build_video_ref(job_id, 0, str(video_out), probe=probe_video_file(str(video_out))))
    elif create_video and len(outputs) >= 2:
        path = video_module.save_video(
            None,
            outputs,
            filename=create_video.get("filename") or None,
            video_type=create_video.get("video_type", "MP4"),
            duration=create_video.get("duration", 2.0),
            loop=create_video.get("loop", True),
            interpolate=create_video.get("interpolate", 0),
            scale=create_video.get("scale", 1.0),
            pad=create_video.get("pad", 1),
            change=create_video.get("change", 0.3),
            sync=True,
        )
        if path and os.path.isfile(str(path)):
            video_refs.append(build_video_ref(job_id, 0, str(path), probe=probe_video_file(str(path))))
        else:
            log.warning(f"Job {job_id}: batch video was not written: {path}")

    result_info = {"postprocessing": info, "mode": mode, "count": len(outputs)}
    if mode == "folder":
        result_info["output_dir"] = output_dir or outpath
    result = {"images": image_refs, "videos": video_refs, "info": result_info, "params": {k: v for k, v in params.items() if k not in ("type", "images", "video")}}
    if staged:
        root = get_staging_dir()
        if root:
            result["_staging_dir"] = os.path.join(root, job_id)
    return result


def execute_caption(params: dict, job_id: str) -> dict:  # pylint: disable=unused-argument
    from modules import shared
    from modules.api import helpers

    backend = params.get("backend", "vlm")
    image = helpers.decode_base64_to_image(params.get("image", ""))
    model = params.get("model")

    jobid = shared.state.begin("API-V2-CAP", api=True)
    try:
        if backend == "vlm":
            from modules.api.caption import ReqVQA, do_caption

            fields = {"model": model} if model else {}
            if params.get("prompt"):
                fields["question"] = params["prompt"]
            req = ReqVQA(image="", **fields)
            answer, _annotated = do_caption(image, req)
            caption_text = answer
        elif backend == "openclip":
            from modules.api.caption import ReqCaptionOpenCLIP, do_openclip

            req = ReqCaptionOpenCLIP(image="", model=model)
            caption_text, *_ = do_openclip(image, req)
        elif backend == "tagger":
            from modules.api.caption import ReqTagger, do_tagger

            req = ReqTagger(image="", model=model)
            tags, _scores = do_tagger(image, req)
            caption_text = tags
        else:
            raise ValueError(f"Unknown caption backend: {backend}")
    finally:
        shared.state.end(jobid)

    return {"images": [], "info": {"caption": caption_text}, "params": {k: v for k, v in params.items() if k not in ("type", "image")}}


def execute_enhance(params: dict, job_id: str) -> dict:  # pylint: disable=unused-argument
    from modules import processing_helpers, shared
    from modules.api import helpers

    prompt = params.get("prompt", "")
    model = params.get("model")
    enhance_type = params.get("enhance_type", "text")
    seed = processing_helpers.get_fixed_seed(params.get("seed", -1))
    image = helpers.decode_base64_to_image(params["image"]) if params.get("image") else None

    jobid = shared.state.begin("API-V2-ENH", api=True)
    try:
        if enhance_type == "video":
            from modules.ui_video_vlm import enhance_prompt

            default_model = "Google Gemma 3 4B" if model is None or len(model) < 4 else model
            result_prompt = enhance_prompt(enable=True, image=image, prompt=prompt, model=default_model, system_prompt=params.get("system_prompt", ""), nsfw=params.get("nsfw", False))
        else:
            from modules.scripts_manager import scripts_txt2img

            default_model = "google/gemma-3-4b-it" if enhance_type == "image" else "google/gemma-3-1b-it"
            use_model = default_model if model is None or len(model) < 4 else model
            instance = next(s for s in scripts_txt2img.scripts if "prompt_enhance.py" in s.filename)
            result_prompt = instance.enhance(
                model=use_model,
                prompt=prompt,
                system=params.get("system_prompt", ""),
                prefix=params.get("prefix", ""),
                suffix=params.get("suffix", ""),
                sample=params.get("do_sample", True),
                tokens=params.get("max_tokens", 256),
                temperature=params.get("temperature", 0.7),
                penalty=params.get("repetition_penalty", 1.2),
                top_k=params.get("top_k", 50),
                top_p=params.get("top_p", 0.9),
                thinking=params.get("thinking", False),
                keep_thinking=params.get("keep_thinking", False),
                use_vision=params.get("use_vision", False),
                prefill=params.get("prefill", ""),
                keep_prefill=params.get("keep_prefill", False),
                image=image,
                seed=seed,
                nsfw=params.get("nsfw", False),
            )
    finally:
        shared.state.end(jobid)

    return {"images": [], "info": {"prompt": result_prompt, "seed": seed}, "params": {k: v for k, v in params.items() if k not in ("type", "image")}}


def execute_detail(params: dict, job_id: str) -> dict:
    """Run only the detailer pass on an input image.

    Mirrors SD.Next's denoise=0 + detailer workflow: the input image goes
    through img2img as a near-identity passthrough (strength=0, 1 step,
    VAE roundtrip), then the detailer operates on the output to detect
    regions (faces, hands, etc.) and inpaint them. Sidesteps control_run
    entirely.
    """
    from modules import processing, processing_helpers, shared
    from modules.api import helpers
    from modules.processing_class import StableDiffusionProcessingImg2Img

    inputs = params.get("inputs") or []
    if not inputs:
        raise ValueError("execute_detail: 'inputs' must contain at least one image ref")
    image = helpers.decode_base64_to_image(inputs[0])
    if image is None:
        raise ValueError("execute_detail: failed to resolve input image ref")

    save_images = params.get("save_images", True)
    sampler_name = params.get("sampler_name", "Default")
    sampler_index = processing_helpers.get_sampler_index(sampler_name)

    # V2 detailer schema: parse defaults + per-model entries (see DetailerMixin)
    defaults = params.get("detailer_defaults") or {}
    model_entries = normalize_detailer_models(params.get("detailer_models"))
    if not model_entries:
        raise ValueError("execute_detail: detailer_models must contain at least one entry")
    model_names = [entry["name"] for entry in model_entries]

    p = StableDiffusionProcessingImg2Img(
        sd_model=shared.sd_model,
        prompt=params.get("prompt", ""),
        negative_prompt=params.get("negative_prompt", ""),
        seed=params.get("seed", -1),
        sampler_index=sampler_index,
        steps=1,
        width=params.get("width", image.width),
        height=params.get("height", image.height),
        init_images=[image],
        denoising_strength=0.0,
        # The executor saves the returned image once itself; skip the pipeline's
        # own save to avoid writing each file to disk twice.
        do_not_save_grid=True,
        do_not_save_samples=True,
        detailer_enabled=True,
        override_settings=params.get("override_settings") or None,
    )
    # Near-passthrough img2img: strength=0 + 1 step preserves the input
    # through a VAE roundtrip; the detailer then operates on the output.
    # Avoids p.skip=['base'], which requires shared.history.last_latent
    # to be pre-populated -- not the case for a fresh job.
    # Apply V2 defaults block to p.detailer_* attributes
    apply_detailer_defaults(p, defaults)
    # Set the model list so process_samples sees a non-empty list and runs
    # the detailer block. The monkey-patch then iterates model_entries with
    # per-model overrides; SD.Next never sees more than one name at a time.
    p.detailer_models = model_names

    restore = install_detailer_per_model_patch(model_entries)
    jobid = shared.state.begin("API-V2-DTL", api=True)
    try:
        processed = processing.process_images_inner(p)
        output_images = list(processed.images) if processed and getattr(processed, "images", None) else []
        saved_paths = list(shared.state.results) if hasattr(shared.state, "results") and shared.state.results else []
    finally:
        shared.state.end(jobid)
        restore()

    image_refs = []
    for i, img in enumerate(output_images):
        path = saved_paths[i] if i < len(saved_paths) else None
        if path and os.path.isfile(str(path)):
            path = str(path)
            ext = os.path.splitext(path)[1].lstrip(".").lower()
            image_refs.append(
                {
                    "index": i,
                    "path": path,
                    "url": f"/sdapi/v2/jobs/{job_id}/images/{i}",
                    "width": img.width if hasattr(img, "width") else 0,
                    "height": img.height if hasattr(img, "height") else 0,
                    "format": ext if ext else "png",
                    "size": os.path.getsize(path),
                }
            )
        elif img is not None:
            if save_images:
                from modules import images as img_module
                from modules.paths import resolve_output_path

                try:
                    output_dir = resolve_output_path(shared.opts.outdir_samples, shared.opts.outdir_img2img_samples)
                    img_info = img.info.get("parameters") if isinstance(getattr(img, "info", None), dict) else None
                    path_info = img_module.save_image(img, output_dir, "", seed=params.get("seed", -1), prompt=params.get("prompt", ""), info=img_info)
                    if path_info and len(path_info) > 0:
                        fpath = path_info[0] if isinstance(path_info, (list, tuple)) else str(path_info)
                        if os.path.isfile(str(fpath)):
                            ext = os.path.splitext(str(fpath))[1].lstrip(".").lower()
                            image_refs.append(
                                {
                                    "index": i,
                                    "path": str(fpath),
                                    "url": f"/sdapi/v2/jobs/{job_id}/images/{i}",
                                    "width": img.width if hasattr(img, "width") else 0,
                                    "height": img.height if hasattr(img, "height") else 0,
                                    "format": ext if ext else "png",
                                    "size": os.path.getsize(str(fpath)),
                                }
                            )
                except Exception as e:
                    log.warning(f"Job {job_id}: failed to save fallback image {i}: {e}")
            else:
                from enso_api.temp_store import stage_image

                try:
                    staged = stage_image(job_id, i, img)
                    if staged:
                        image_refs.append(
                            {
                                "index": i,
                                "path": staged["path"],
                                "url": f"/sdapi/v2/jobs/{job_id}/images/{i}",
                                "width": staged["width"],
                                "height": staged["height"],
                                "format": staged["format"],
                                "size": staged["size"],
                                "temp": True,
                            }
                        )
                except Exception as e:
                    log.warning(f"Job {job_id}: failed to stage temp image {i}: {e}")

    result = {"images": image_refs, "info": {}, "params": {k: v for k, v in params.items() if k != "type"}}
    if not save_images and image_refs:
        from enso_api.temp_store import get_staging_dir

        root = get_staging_dir()
        if root:
            result["_staging_dir"] = os.path.join(root, job_id)
    return result


def execute_detect(params: dict, job_id: str) -> dict:  # pylint: disable=unused-argument
    from modules import shared
    from modules.api import helpers

    image = helpers.decode_base64_to_image(params.get("image", ""))
    model = params.get("model")

    jobid = shared.state.begin("API-V2-DET", api=True)
    try:
        # predict(name, model, image): name drives the LocateAnything-vs-YOLO
        # dispatch, model is loaded by name inside yolo.predict. Mirror v1
        # /detect. Empty name (model=None) routes to YOLO's default detector.
        items = shared.detailer.predict(model or "", model, image)
        detections = []
        for item in items:
            detections.append(
                {
                    "label": item.label,
                    "score": item.score,
                    "cls": item.cls,
                    "box": item.box,
                }
            )
    finally:
        shared.state.end(jobid)

    return {"images": [], "info": {"detections": detections}, "params": {k: v for k, v in params.items() if k not in ("type", "image")}}


def execute_preprocess(params: dict, job_id: str) -> dict:
    from modules import shared
    from modules.api import helpers
    from modules.control import processors

    image = helpers.decode_base64_to_image(params.get("image", ""))
    model = params.get("model", "")
    proc_params = params.get("params", {}) or {}

    processors_list = list(processors.config)
    if model not in processors_list:
        raise ValueError(f"Processor model not found: {model}")

    jobid = shared.state.begin("API-V2-PRE", api=True)
    try:
        proc = processors.Processor(model)
        processed = proc(image, local_config=proc_params)
        # Save processed image to disk
        from modules import images as img_module

        output_dir = shared.opts.outdir_extras_samples if hasattr(shared.opts, "outdir_extras_samples") else shared.opts.outdir_txt2img_samples
        path_info = img_module.save_image(processed, output_dir, "", prompt=f"preprocess-{model}")
    finally:
        shared.state.end(jobid)

    image_refs = []
    if path_info:
        fpath = path_info[0] if isinstance(path_info, (list, tuple)) else str(path_info)
        if os.path.isfile(str(fpath)):
            ext = os.path.splitext(str(fpath))[1].lstrip(".").lower()
            image_refs.append({"index": 0, "path": str(fpath), "url": f"/sdapi/v2/jobs/{job_id}/images/0", "width": processed.width, "height": processed.height, "format": ext or "png", "size": os.path.getsize(str(fpath))})

    return {"images": image_refs, "info": {"model": model}, "params": {k: v for k, v in params.items() if k not in ("type", "image")}}


video_script_defaults: list = []


def execute_video(params: dict, job_id: str) -> dict:
    from modules import processing, scripts_manager, shared, ui
    from modules.api import helpers
    from modules.api import script as api_script
    from modules.video_models import video_run

    engine = params.get("engine") or None
    model = params.get("model") or None
    width = params.get("width", 848)
    height = params.get("height", 480)

    sampler = params.get("sampler", 0)
    sampler_name = processing.get_sampler_name(sampler) if isinstance(sampler, int) else str(sampler)

    init_image = helpers.decode_base64_to_image(params["init_image"]) if params.get("init_image") else None
    last_image = helpers.decode_base64_to_image(params["last_image"]) if params.get("last_image") else None

    # Staged references pass as file paths: the core classifies paths by
    # extension (image/video/audio) and EXIF-transposes images via load_image,
    # neither of which the base64 decode provides. Raw base64 entries can only
    # be images and keep the decode path.
    def reference_entry(ref: str):
        if isinstance(ref, str) and ref.startswith("upload:"):
            from enso_api.upload import get_upload_store

            path = get_upload_store().resolve_to_path(ref.removeprefix("upload:"))
            if path is not None:
                return path
        return helpers.decode_base64_to_image(ref)

    references = [reference_entry(x) for x in (params.get("references") or [])]

    # always-on video scripts need their bootstrapped default args; running
    # them against an empty args tuple raises a TypeError per frame
    script_runner = scripts_manager.scripts_video
    if not script_runner.scripts:
        script_runner.initialize_scripts(is_img2img=False, is_control=False, is_video=True)
        ui.create_ui(None)
    if not video_script_defaults:
        video_script_defaults.extend(api_script.init_default_script_args(script_runner))

    # video_run raises VideoError on resolution and generation failures; let it
    # propagate so the worker marks the job failed with the message
    selected, needs_load = video_run.resolve_model(engine, model)

    jobid = shared.state.begin("API-V2-VID", api=True)
    try:
        res = video_run.run(
            selected,
            prompt=params.get("prompt", ""),
            negative=params.get("negative", ""),
            styles=params.get("styles") or [],
            width=width,
            height=height,
            frames=params.get("frames", 25),
            steps=params.get("steps", 30),
            sampler_name=sampler_name,
            sampler_shift=params.get("sampler_shift", -1),
            dynamic_shift=params.get("dynamic_shift", False),
            seed=params.get("seed", -1),
            guidance_scale=params.get("guidance_scale", 6.0),
            guidance_true=params.get("guidance_true", -1),
            init_image=init_image,
            init_strength=params.get("init_strength", 0.5),
            last_image=last_image,
            references=references,
            vae_type=params.get("vae_type", "Default"),
            vae_tile_frames=params.get("vae_tile_frames", 0),
            audio=params.get("audio", True),
            mp4_fps=params.get("fps", 24),
            mp4_interpolate=params.get("interpolate", 0),
            mp4_codec=params.get("codec", "libx264"),
            mp4_ext=params.get("format", "mp4"),
            mp4_opt=params.get("codec_options", "crf=16"),
            mp4_video=params.get("save_video", True),
            mp4_frames=params.get("save_frames", False),
            mp4_sf=params.get("save_safetensors", False),
            mp4_thumb=params.get("save_thumbnail", True),
            override_settings=dict(params.get("override_settings") or {}),
            engine=engine,
            scripts=script_runner,
            script_args=video_script_defaults,
            needs_load=needs_load,
        )
        # Capture saved file paths BEFORE end() clears state.results; in still
        # mode the product is an image saved through the regular sample path,
        # and its filename only surfaces here
        saved_paths = [str(p2) for p2 in (getattr(shared.state, "results", None) or [])]
    finally:
        shared.state.end(jobid)

    videos_refs: list[dict] = []
    if res.still:
        still = res.images[0] if res.images else None
        path = next((p2 for p2 in saved_paths if os.path.isfile(p2)), None)
        if path is None and still is not None:
            # samples_save disabled: nothing was written, so save the still
            # directly to keep the job result addressable
            from modules import images as img_module
            from modules.paths import resolve_output_path

            try:
                output_dir = resolve_output_path(shared.opts.outdir_samples, shared.opts.outdir_video)
                still_info = still.info.get("parameters") if isinstance(getattr(still, "info", None), dict) else None
                saved = img_module.save_image(still, output_dir, "", seed=params.get("seed", -1), prompt=params.get("prompt", ""), info=still_info)
                if saved and saved[0] and os.path.isfile(str(saved[0])):
                    path = str(saved[0])
            except Exception as e:
                log.warning(f"Job {job_id}: failed to save video still: {e}")
        if path:
            ext = os.path.splitext(path)[1].lstrip(".").lower()
            videos_refs.append(
                {
                    "index": 0,
                    "path": path,
                    # the still is its own thumbnail; the strip and the viewer
                    # both render image formats directly
                    "thumbnail_path": path,
                    "url": f"/sdapi/v2/jobs/{job_id}/videos/0",
                    "thumbnail_url": f"/sdapi/v2/jobs/{job_id}/videos/0/thumbnail",
                    "width": still.width if still is not None else 0,
                    "height": still.height if still is not None else 0,
                    "format": ext or "png",
                    "size": os.path.getsize(path),
                    "duration": None,
                }
            )
    elif res.video_path and os.path.isfile(str(res.video_path)):
        from enso_api.video_result import build_video_ref

        path = str(res.video_path)
        thumb_path = str(res.thumb_path) if res.thumb_path and os.path.isfile(str(res.thumb_path)) else None
        # per-engine snapping diverges from the universal 16px rule (LTX and
        # MiniMax use 32); the container probe reports the real dimensions and
        # the core-reported values are the fallback
        videos_refs.append(build_video_ref(job_id, 0, path, thumb_path=thumb_path, width=16 * (int(width) // 16), height=16 * (int(height) // 16), fps=res.fps, frames=res.num_frames))

    info = {"engine": engine or "Loaded", "model": selected.name, "frames": res.num_frames, "fps": res.fps, "has_audio": res.has_audio}
    return {"videos": videos_refs, "info": info, "params": {k: v for k, v in params.items() if k not in ("type", "init_image", "last_image", "references")}}


def execute_framepack(params: dict, job_id: str) -> dict:
    from modules import shared
    from modules.api import helpers
    from modules.framepack import framepack_wrappers

    init_image = helpers.decode_base64_to_image(params["init_image"]) if params.get("init_image") else None
    end_image = helpers.decode_base64_to_image(params["end_image"]) if params.get("end_image") else None

    prompt = params.get("prompt", "")
    negative = params.get("negative", "")
    styles = params.get("styles", [])
    seed = params.get("seed", -1)
    resolution = params.get("resolution", 640)
    duration = params.get("duration", 4)
    variant = params.get("variant", "Bi-Directional")
    attention = params.get("attention", "Default")

    jobid = shared.state.begin("API-V2-FP", api=True)
    try:
        # keyword-only, matching the run_ltx call above
        gen = framepack_wrappers.run_framepack(
            task_id="",
            _ui_state="",
            init_image=init_image,
            end_image=end_image,
            start_weight=params.get("start_weight", 1.0),
            end_weight=params.get("end_weight", 1.0),
            vision_weight=params.get("vision_weight", 1.0),
            prompt=prompt,
            system_prompt=params.get("system_prompt", ""),
            optimized_prompt=params.get("optimized_prompt", True),
            section_prompt=params.get("section_prompt", ""),
            negative_prompt=negative,
            styles=styles,
            seed=seed,
            resolution=resolution,
            duration=duration,
            latent_ws=params.get("latent_ws", 9),
            steps=params.get("steps", 25),
            cfg_scale=params.get("cfg_scale", 1.0),
            cfg_distilled=params.get("cfg_distilled", 10.0),
            cfg_rescale=params.get("cfg_rescale", 0.0),
            shift=params.get("shift", 3.0),
            use_teacache=params.get("use_teacache", True),
            use_cfgzero=params.get("use_cfgzero", False),
            use_preview=params.get("use_preview", True),
            mp4_fps=params.get("fps", 30),
            mp4_codec=params.get("codec", "libx264"),
            mp4_sf=params.get("save_safetensors", False),
            mp4_video=params.get("save_video", True),
            mp4_frames=params.get("save_frames", False),
            mp4_thumb=params.get("save_thumbnail", True),
            mp4_opt=params.get("codec_options", "crf=16"),
            mp4_ext=params.get("format", "mp4"),
            mp4_interpolate=params.get("interpolate", 0),
            attention=attention,
            vae_type=params.get("vae_type", "Full"),
            variant=variant,
            vlm_enhance=params.get("vlm_enhance", False),
            vlm_model=params.get("vlm_model", ""),
            vlm_system_prompt=params.get("vlm_system_prompt", ""),
        )
        video_file = None
        for item in gen:
            if item and len(item) > 0 and isinstance(item[0], str) and item[0] and not item[0].startswith("<"):
                video_file = item[0]
    finally:
        shared.state.end(jobid)

    from enso_api.video_result import build_video_ref, probe_video_file

    videos_refs = []
    info = {"engine": "FramePack", "model": variant, "frames": 0, "fps": 0.0, "has_audio": False}
    if video_file and os.path.isfile(str(video_file)):
        path = str(video_file)
        probe = probe_video_file(path)
        # resolution is a bucket scalar, not the real canvas; the probe reports
        # the actual dimensions and the square is only the probe-failure fallback
        videos_refs.append(build_video_ref(job_id, 0, path, probe=probe, width=resolution, height=resolution, fps=params.get("fps", 30)))
        info.update({"frames": probe["frames"], "fps": probe["fps"] or params.get("fps", 30), "has_audio": probe["has_audio"]})

    return {"videos": videos_refs, "info": info, "params": {k: v for k, v in params.items() if k not in ("type", "init_image", "end_image")}}


def execute_ltx(params: dict, job_id: str) -> dict:
    from modules import shared
    from modules.api import helpers
    from modules.ltx import ltx_process

    model = params.get("model", "")
    prompt = params.get("prompt", "")
    negative = params.get("negative", "")
    styles = params.get("styles", [])
    width = params.get("width", 768)
    height = params.get("height", 512)
    frames = params.get("frames", 97)
    steps = params.get("steps", 50)
    sampler_index = params.get("sampler", 0)
    seed = params.get("seed", -1)

    condition_image = helpers.decode_base64_to_image(params["condition_image"]) if params.get("condition_image") else None
    condition_last = helpers.decode_base64_to_image(params["condition_last"]) if params.get("condition_last") else None

    jobid = shared.state.begin("API-V2-LTX", api=True)
    try:
        # keyword-only: run_ltx swallows **kwargs, so future signature growth
        # degrades to defaults instead of mis-binding positional args
        gen = ltx_process.run_ltx(
            task_id="",
            _ui_state="",
            model=model,
            prompt=prompt,
            negative=negative,
            styles=styles,
            width=width,
            height=height,
            frames=frames,
            auto_duration=params.get("auto_duration", False),
            steps=steps,
            sampler_index=sampler_index,
            guidance_scale=params.get("guidance_scale", 4.0),
            sampler_shift=params.get("sampler_shift", -1.0),
            dynamic_shift=params.get("dynamic_shift", False),
            seed=seed,
            upsample_enable=params.get("upsample_enable", False),
            upsample_ratio=params.get("upsample_ratio", 2.0),
            refine_enable=params.get("refine_enable", False),
            refine_strength=params.get("refine_strength", 0.4),
            condition_strength=params.get("condition_strength", 0.8),
            ltx_init_image=condition_image,
            condition_last=condition_last,
            condition_files=None,
            condition_video=None,
            condition_video_frames=params.get("condition_video_frames", 0),
            condition_video_skip=params.get("condition_video_skip", 0),
            decode_timestep=params.get("decode_timestep", 0.05),
            image_cond_noise_scale=params.get("image_cond_noise_scale", 0.025),
            mp4_fps=params.get("fps", 24),
            mp4_interpolate=params.get("interpolate", 0),
            mp4_codec=params.get("codec", "libx264"),
            mp4_ext=params.get("format", "mp4"),
            mp4_opt=params.get("codec_options", "crf=16"),
            mp4_video=params.get("save_video", True),
            mp4_frames=params.get("save_frames", False),
            mp4_sf=params.get("save_safetensors", False),
            mp4_thumb=params.get("save_thumbnail", True),
            audio_enable=params.get("audio_enable", False),
            _overrides={},
        )
        video_file = None
        for item in gen:
            if item and len(item) > 0 and isinstance(item[0], str) and item[0]:
                video_file = item[0]
    finally:
        shared.state.end(jobid)

    from enso_api.video_result import build_video_ref, probe_video_file

    videos_refs = []
    info = {"engine": "LTX Video", "model": model, "frames": 0, "fps": 0.0, "has_audio": False}
    if video_file and os.path.isfile(str(video_file)):
        path = str(video_file)
        probe = probe_video_file(path)
        videos_refs.append(build_video_ref(job_id, 0, path, probe=probe, width=width, height=height, fps=params.get("fps", 24)))
        info.update({"frames": probe["frames"], "fps": probe["fps"] or params.get("fps", 24), "has_audio": probe["has_audio"]})

    return {"videos": videos_refs, "info": info, "params": {k: v for k, v in params.items() if k not in ("type", "condition_image", "condition_last")}}


def execute_xyz_grid_dispatch(params: dict, job_id: str) -> dict:
    from enso_api.xyz_grid import execute_xyz_grid

    return execute_xyz_grid(params, job_id)


def execute_model_load(params: dict, job_id: str) -> dict:  # pylint: disable=unused-argument
    """Load or reload a checkpoint as a V2 job.

    SD.Next's reload_model_weights() manages its own shared.state.begin/end
    internally, so we don't wrap it in another state block - the job queue's
    progress poller picks up the state that reload_model_weights sets.

    Note: model loading is not cancellable - reload_model_weights does not
    check shared.state.interrupted. Cancellation will only take effect
    before execution starts (while queued) or after it completes.
    """
    from modules import devices, modelloader, sd_models, shared

    checkpoint = params.get("sd_model_checkpoint")
    force = params.get("force", False)
    dtype = params.get("dtype")

    if force:
        sd_models.unload_model_weights(op="model")
    if dtype is not None:
        shared.opts.cuda_dtype = dtype
        devices.set_dtype()
    if checkpoint:
        ref_opts = modelloader.get_reference_opts(checkpoint, quiet=True)
        if ref_opts:
            if "@" not in checkpoint:
                loaded = modelloader.load_reference(checkpoint)
                if not loaded:
                    raise RuntimeError(f"Failed to load reference model: {checkpoint}")
            else:
                model, url = checkpoint.split("@", 1)
                loaded = modelloader.load_civitai(model, url)
                if loaded is not None:
                    checkpoint = loaded
                else:
                    raise RuntimeError(f"Failed to load CivitAI model: {checkpoint}")
        shared.opts.sd_model_checkpoint = checkpoint
    sd_models.reload_model_weights()

    # Build checkpoint info for the result
    info = {"loaded": shared.sd_loaded and shared.sd_model is not None}
    if shared.sd_loaded and shared.sd_model is not None:
        info["type"] = shared.sd_model_type
        info["class_name"] = shared.sd_model.__class__.__name__
        if hasattr(shared.sd_model, "sd_model_checkpoint"):
            info["checkpoint"] = shared.sd_model.sd_model_checkpoint
        if hasattr(shared.sd_model, "sd_checkpoint_info"):
            ci = shared.sd_model.sd_checkpoint_info
            info["title"] = ci.title
            info["name"] = ci.name
            info["filename"] = ci.filename
            info["hash"] = ci.shorthash

    return {"images": [], "info": info, "params": {k: v for k, v in params.items() if k != "type"}}


def execute_model_merge(params: dict, job_id: str) -> dict:  # pylint: disable=unused-argument
    """Merge two or three checkpoint models as a V2 job.

    SD.Next's run_modelmerger() manages its own shared.state.begin/end
    internally, so we don't wrap it in another state block.
    """
    from modules import extras, sd_models

    merge_params = {k: v for k, v in params.items() if k != "type" and v not in [None, "None", "", 0, []]}
    if not merge_params.get("custom_name"):
        raise ValueError("Merge requires an output model name")
    if not merge_params.get("primary_model_name") or not merge_params.get("secondary_model_name"):
        raise ValueError("Merge requires primary and secondary models")

    results = extras.run_modelmerger(None, **merge_params)
    status = results[-1] if isinstance(results, list) else str(results)
    sd_models.list_models()

    return {"images": [], "info": {"status": status}, "params": {k: v for k, v in params.items() if k != "type"}}


def execute_model_replace(params: dict, job_id: str) -> dict:  # pylint: disable=unused-argument
    """Replace model components and save as a new model as a V2 job.

    SD.Next's run_model_modules() is a generator that manages its own
    shared.state.begin/end internally. The generator must be iterated
    to completion so state.end is reached.
    """
    from modules import extras

    status = "Unknown"
    for msg in extras.run_model_modules(
        params.get("model_type", ""),
        params.get("model_name", ""),
        params.get("custom_name", ""),
        params.get("comp_unet", ""),
        params.get("comp_vae", ""),
        params.get("comp_te1", ""),
        params.get("comp_te2", ""),
        params.get("precision", "fp16"),
        params.get("comp_scheduler", ""),
        params.get("comp_prediction", ""),
        params.get("comp_lora", ""),
        params.get("comp_fuse", 0.0),
        params.get("meta_author", ""),
        params.get("meta_version", ""),
        params.get("meta_license", ""),
        params.get("meta_desc", ""),
        params.get("meta_hint", ""),
        None,  # meta_thumbnail - not applicable via API
        params.get("create_diffusers", True),
        params.get("create_safetensors", False),
        params.get("debug", False),
    ):
        status = msg

    return {"images": [], "info": {"status": status}, "params": {k: v for k, v in params.items() if k != "type"}}


def execute_model_save(params: dict, job_id: str) -> dict:  # pylint: disable=unused-argument
    """Save the currently loaded model to disk as a V2 job.

    sd_models.save_model() does not manage shared.state, so we wrap
    the call in state.begin/end for progress visibility.
    """
    from modules import sd_models, shared

    name = params.get("name", "")
    if not name:
        raise ValueError("Save requires a model name")

    jobid = shared.state.begin("Save", api=True)
    try:
        result = sd_models.save_model(
            name=name,
            path=params.get("path"),
            shard=params.get("shard"),
            overwrite=params.get("overwrite", False),
        )
    finally:
        shared.state.end(jobid)

    if result and any(result.startswith(e) for e in ["Invalid", "Model not", "Path exists", "Error"]):
        raise RuntimeError(result)

    return {"images": [], "info": {"status": result}, "params": {k: v for k, v in params.items() if k != "type"}}


def execute_loader_load(params: dict, job_id: str) -> dict:  # pylint: disable=unused-argument
    """Load a model with custom component configuration as a V2 job.

    ui_models_load.load_model() does not manage shared.state, so we wrap
    the call in state.begin/end. Delegates to models_ops.post_loader_load()
    to reuse the component setup logic.
    """
    from modules import shared

    from enso_api.models import ReqLoaderLoadV2
    from enso_api.models_ops import post_loader_load

    model_type = params.get("model_type", "")
    repo = params.get("repo", "")
    if not model_type or not repo:
        raise ValueError("Loader requires model_type and repo")

    req = ReqLoaderLoadV2.model_validate({"model_type": model_type, "repo": repo, "components": params.get("components")})

    jobid = shared.state.begin("Load", api=True)
    try:
        result = post_loader_load(req)
    finally:
        shared.state.end(jobid)

    return {"images": [], "info": result, "params": {k: v for k, v in params.items() if k != "type"}}


def execute_lora_extract(params: dict, job_id: str) -> dict:  # pylint: disable=unused-argument
    """Extract a LoRA from the currently loaded model as a V2 job.

    lora_extract.make_lora() is a generator that manages its own
    shared.state.begin/end internally. The generator must be iterated
    to completion so state.end is reached.
    """
    from modules.lora import lora_extract

    filename = params.get("filename", "")
    if not filename:
        raise ValueError("LoRA extract requires a filename")

    status = "Unknown"
    for msg in lora_extract.make_lora(
        filename,
        params.get("max_rank", 64),
        params.get("auto_rank", False),
        params.get("rank_ratio", 0.5),
        params.get("modules", ["te", "unet"]),
        params.get("overwrite", False),
    ):
        status = msg

    return {"images": [], "info": {"status": status}, "params": {k: v for k, v in params.items() if k != "type"}}


def execute_hf_download(params: dict, job_id: str) -> dict:  # pylint: disable=unused-argument
    """Download a model from HuggingFace Hub as a V2 job.

    models_hf.hf_download_model() delegates to download_diffusers_model()
    which manages its own shared.state.begin/end internally.
    """
    from modules import models_hf

    hub_id = params.get("hub_id", "")
    if not hub_id:
        raise ValueError("HF download requires a hub_id")

    result = models_hf.hf_download_model(
        hub_id,
        params.get("token", ""),
        params.get("variant", ""),
        params.get("revision", ""),
        params.get("mirror", ""),
        params.get("custom_pipeline", ""),
    )

    return {"images": [], "info": {"status": result}, "params": {k: v for k, v in params.items() if k != "type"}}


class MetadataSweepBusy(Exception):
    """Another CivitAI metadata sweep already holds the lock."""

    code = 409


def execute_metadata_sweep(params: dict, job_id: str) -> dict:  # pylint: disable=unused-argument
    """Sweep local models against CivitAI metadata.

    Both sweeps share one lock in sdnext. The first update run hashes every
    uncached checkpoint inline and reports through shared.state as 'CivitAI hash'.
    """
    from modules.civitai import metadata_civitai

    mode = params.get("mode", "scan")
    sweep = metadata_civitai.civit_update_metadata if mode == "update" else metadata_civitai.civit_search_metadata

    items = []
    try:
        for batch in sweep(raw=True):
            if isinstance(batch, list):
                items = batch
    except metadata_civitai.SweepBusy as e:
        raise MetadataSweepBusy(str(e)) from e

    if mode == "update":
        results = [
            {
                "file": getattr(item, "file", None),
                "id": getattr(item, "id", None),
                "name": getattr(item, "name", None),
                "sha": getattr(item, "sha", None),
                "versions": getattr(item, "versions", None),
                "latest": getattr(item, "latest_name", None),
                "status": getattr(item, "status", None),
            }
            for item in items
        ]
    else:
        results = items

    return {"images": [], "info": {"mode": mode, "results": results}, "params": {k: v for k, v in params.items() if k != "type"}}


def execute_rembg(params: dict, job_id: str) -> dict:
    """The pre-process wire shape: a process job running only the Remove background script."""
    return execute_process(
        {
            "mode": "image",
            "images": [params.get("image", "")],
            "save_output": True,
            "rembg": {
                "model": params.get("model", "ben2"),
                "merge_alpha": False,
                "refine": params.get("refine", False),
                "mask_only": params.get("return_mask", False),
                "postprocess_mask": False,
                "alpha_matting": params.get("alpha_matting", False),
                "alpha_matting_foreground_threshold": params.get("alpha_matting_foreground_threshold", 240),
                "alpha_matting_background_threshold": params.get("alpha_matting_background_threshold", 10),
                "alpha_matting_erode_size": params.get("alpha_matting_erode_size", 10),
            },
        },
        job_id,
    )


from enso_api.cloud.executor import (
    execute_cloud_chat,
    execute_cloud_image,
    execute_cloud_stt,
    execute_cloud_tts,
    execute_cloud_video,
)

EXECUTORS = {
    "generate": {"fn": execute_generate, "lock": True},
    "upscale": {"fn": execute_upscale, "lock": True},
    "process": {"fn": execute_process, "lock": True},
    "caption": {"fn": execute_caption, "lock": True},
    "enhance": {"fn": execute_enhance, "lock": True},
    "detect": {"fn": execute_detect, "lock": True},
    "preprocess": {"fn": execute_preprocess, "lock": True},
    "detail": {"fn": execute_detail, "lock": True},
    "video": {"fn": execute_video, "lock": True},
    # lock="internal": run_framepack/run_ltx acquire call_queue.queue_lock
    # themselves; holding the non-reentrant lock here too deadlocks the worker
    "framepack": {"fn": execute_framepack, "lock": "internal"},
    "ltx": {"fn": execute_ltx, "lock": "internal"},
    "xyz-grid": {"fn": execute_xyz_grid_dispatch, "lock": True},
    "model-load": {"fn": execute_model_load, "lock": True},
    "model-merge": {"fn": execute_model_merge, "lock": True},
    "model-replace": {"fn": execute_model_replace, "lock": True},
    "model-save": {"fn": execute_model_save, "lock": True},
    "loader-load": {"fn": execute_loader_load, "lock": True},
    "lora-extract": {"fn": execute_lora_extract, "lock": True},
    "hf-download": {"fn": execute_hf_download, "lock": True},
    # the sweep drives shared.state for its own progress, so it cannot overlap a
    # generation; the lock is also what routes cancel through state.interrupt()
    "metadata-sweep": {"fn": execute_metadata_sweep, "lock": True},
    "rembg": {"fn": execute_rembg, "lock": True},
    "cloud_image": {"fn": execute_cloud_image, "lock": False},
    "cloud_chat": {"fn": execute_cloud_chat, "lock": False},
    "cloud_tts": {"fn": execute_cloud_tts, "lock": False},
    "cloud_stt": {"fn": execute_cloud_stt, "lock": False},
    "cloud_video": {"fn": execute_cloud_video, "lock": False},
}
