"""Model operations API - analyze, save, list, merge, replace, download, extract LoRA.

Provides REST endpoints for model management operations that were previously
only accessible through the Gradio UI.
"""

import inspect
import os

from modules import shared
from modules.logger import log

from enso_api.models import (
    ReqCivitaiDownloadV2,
    ReqHfDownloadV2,
    ReqLoaderComponentsV2,
    ReqLoaderLoadV2,
    ReqLoraExtractV2,
    ReqMergeV2,
    ReqModelAuditFixV2,
    ReqModelAuditV2,
    ReqModelSaveV2,
    ReqReplaceV2,
)


def jsonable(obj):
    """Recursively convert a nested dict/list so all values are JSON-serializable."""
    if isinstance(obj, dict):
        return {k: jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsonable(v) for v in obj]
    if isinstance(obj, (str, int, float, bool, type(None))):
        return obj
    return str(obj)


# ---------------------------------------------------------------------------
# - Current model & list
# ---------------------------------------------------------------------------


def get_analyze():
    """
    Analyze the currently loaded model.

    Returns model name, type, class, hash, file size, metadata, and a breakdown
    of all sub-modules with their device, dtype, quantization, and parameter counts.
    """
    from modules import modelstats

    model = modelstats.analyze()
    if model is None:
        return {}
    return {
        "name": model.name,
        "type": model.type,
        "class": model.cls,
        "hash": model.hash or None,
        "size": model.size,
        "mtime": str(model.mtime) if model.mtime else None,
        "meta": jsonable(model.meta) if model.meta else {},
        "modules": [
            {
                "name": m.name,
                "cls": m.cls,
                "device": str(m.device) if m.device else None,
                "dtype": str(m.dtype) if m.dtype else None,
                "quant": str(m.quant) if m.quant else None,
                "params": m.params,
                "modules": m.modules,
                "config": jsonable(dict(m.config)) if m.config and hasattr(m.config, "items") else None,
            }
            for m in model.modules
        ],
    }


def post_save(req: ReqModelSaveV2):
    """
    Save the currently loaded model to disk.

    Saves the active pipeline under ``name``. Optional ``path`` overrides the output
    directory, ``shard`` sets the shard size, and ``overwrite`` allows replacing
    an existing file.
    """
    from modules import sd_models

    result = sd_models.save_model(name=req.name, path=req.path, shard=req.shard, overwrite=req.overwrite)
    return {"status": result}


def get_list_detail():
    """
    List all checkpoints with detection info.

    Returns every registered checkpoint with its filename, file type, auto-detected
    model type, matching pipeline class, hash, file size, and modification time.
    """
    from modules import modelstats, sd_checkpoint, sd_detect

    rows = []
    for ckpt in sd_checkpoint.checkpoints_list.values():
        try:
            f = ckpt.filename
            stat_size, stat_mtime = modelstats.stat(f)
            if os.path.isfile(f):
                typ = os.path.splitext(f)[1][1:]
            elif os.path.isdir(f):
                typ = "diffusers"
            else:
                typ = "unknown"
            guess = "Diffusion"
            guess = sd_detect.guess_by_size(f, guess)
            guess = sd_detect.guess_by_name(f, guess)
            guess, pipeline = sd_detect.guess_by_diffusers(f, guess)
            guess = sd_detect.guess_variant(f, guess)
            if pipeline is None:
                pipeline = sd_detect.shared_items.get_pipelines().get(guess, None)
            rows.append(
                {
                    "model_name": ckpt.model_name,
                    "filename": ckpt.filename,
                    "type": typ,
                    "detected_type": guess,
                    "pipeline": pipeline.__name__ if pipeline else None,
                    "hash": ckpt.shorthash,
                    "size": stat_size,
                    "mtime": str(stat_mtime) if stat_mtime else None,
                }
            )
        except Exception as e:
            log.error(f"Model list-detail: {e}")
    return rows


def post_update_hashes():
    """
    Recalculate hashes for all registered checkpoints.

    Iterates over every checkpoint and recomputes its short hash. Returns a list
    of updated entries with name, type, and new hash.
    """
    from modules import sd_checkpoint

    updated = []
    for _html in sd_checkpoint.update_model_hashes():
        pass  # consume the generator
    for ckpt in sd_checkpoint.checkpoints_list.values():
        if ckpt.shorthash:
            updated.append({"name": ckpt.model_name, "type": ckpt.type, "hash": ckpt.shorthash})
    return {"updated": updated}


# ---------------------------------------------------------------------------
# - HuggingFace, CivitAI, Metadata
# ---------------------------------------------------------------------------


def get_hf_search(keyword: str = ""):
    """
    Search HuggingFace Hub for models.

    Returns matching models with their repo ID, pipeline tag, tags, download count,
    last modified date, and URL.
    """
    from modules import models_hf

    results = models_hf.hf_search(keyword)
    return [{"id": r[0], "pipeline_tag": r[1], "tags": r[2], "downloads": r[3], "last_modified": r[4], "url": r[5]} for r in results]


def post_hf_download(req: ReqHfDownloadV2):
    """
    Download a model from HuggingFace Hub.

    Downloads the model identified by ``hub_id``. Optional parameters control
    authentication token, variant (e.g., fp16), revision, mirror URL, and custom pipeline.
    """
    from modules import models_hf

    result = models_hf.hf_download_model(req.hub_id, req.token, req.variant, req.revision, req.mirror, req.custom_pipeline)
    return {"status": result}


def post_civitai_download(req: ReqCivitaiDownloadV2):
    """
    Download a model from CivitAI.

    Queues the download and returns the download ID for progress tracking via
    the WebSocket or ``GET /sdapi/v1/civitai/download/status``.
    """
    from modules.civitai.download_civitai import download_manager
    from modules.civitai.filemanage_civitai import get_type_folder

    try:
        from modules.api.security import is_confined_to, validate_download_url
    except ImportError:
        from enso_api.security_stubs import is_confined_to, validate_download_url
    if not req.url:
        return {"status": "Error: no url provided"}
    validate_download_url(req.url)
    if not req.path:
        folder = str(get_type_folder(req.model_type or "Checkpoint"))
    elif os.path.isabs(req.path):
        folder = req.path
    else:
        from modules import paths

        folder = os.path.join(paths.models_path, req.path)
    from modules import paths

    if not is_confined_to(folder, [paths.models_path]):
        return {"status": "Error: path outside models directory"}
    item = download_manager.enqueue(
        url=req.url,
        folder=folder,
        filename=req.name or "Unknown",
        model_type=req.model_type,
        token=req.token,
    )
    return {"status": "queued", "download_id": item.id, "url": req.url}


# folder basename to the file kind it should contain, for audit mismatch checks
FOLDER_KINDS = {
    "Stable-diffusion": "model",
    "UNET": "model",
    "Lora": "lora",
    "VAE": "vae",
    "Text-encoder": "text-encoder",
}
# ordered longest-first so substrings (fp8 in mxfp8) cannot shadow the claim
FILENAME_PRECISIONS = ("nvfp4", "mxfp8", "int8", "fp16", "bf16", "fp32", "nf4", "fp8")
ROLE_NAME_SUFFIXES = ("high-noise", "low-noise", "uncond")


def get_model_probe(path: str):
    """
    Header-only analysis of a local model file.

    Returns the architecture fingerprint, dtype/quant detection, and embedded
    metadata (kohya ``ss_*`` keys at full fidelity) without reading weights.
    """
    from modules import model_probe
    from modules.civitai.filemanage_civitai import iter_type_roots

    try:
        from modules.api.security import is_confined_to
    except ImportError:
        from enso_api.security_stubs import is_confined_to
    roots = [str(r) for r in iter_type_roots()]
    if not path or not is_confined_to(path, roots):
        return model_probe.error_result("unknown", "path outside model directories", "denied")
    if not os.path.isfile(path):
        return model_probe.error_result("unknown", "file not found", "missing")
    result = model_probe.probe_file(path)
    model_probe.save_probe_cache()
    return result


def audit_mismatches(path: str, root: str, probe: dict) -> list:
    from modules.model_probe import family_from_text

    mismatches = []
    arch = probe.get("arch", {})
    kind = arch.get("kind")
    implied = FOLDER_KINDS.get(os.path.basename(root))
    known = ("model", "lora", "vae", "text-encoder")
    if implied and kind in known and implied != kind:
        mismatches.append({"kind": "folder_vs_arch", "claimed": implied, "actual": kind})
    basename = os.path.basename(path).lower()
    claimed_fp = next((p for p in FILENAME_PRECISIONS if p in basename), None)
    if claimed_fp:
        from modules.model_probe import precision_token

        actual_fp = precision_token(probe)
        if actual_fp and claimed_fp != actual_fp:
            mismatches.append({"kind": "filename_precision", "claimed": claimed_fp, "actual": actual_fp})
    rel = os.path.relpath(path, root)
    subfolder = rel.split(os.sep)[0] if os.sep in rel else ""
    implied_family = family_from_text(subfolder) if subfolder else None
    family = arch.get("family")
    if implied_family and family not in (None, "unknown") and arch.get("confidence", 0) >= 0.7 and family != implied_family:
        mismatches.append({"kind": "base_vs_arch", "claimed": implied_family, "actual": family})
    return mismatches


def post_model_audit(req: ReqModelAuditV2):
    """
    Header-only audit of the local model libraries.

    Probes every model file under the configured model roots and reports
    actual architecture, precision, and quantization against what the folder
    and filename claim. Cached by mtime, so repeat scans are near-instant.
    """
    import time

    from modules import files_cache, model_probe
    from modules.civitai.filemanage_civitai import iter_type_roots

    start = time.time()
    exts = tuple(req.exts) if req.exts else (".safetensors", ".gguf")
    roots = [str(r) for r in iter_type_roots()]
    if req.roots:
        wanted = set(req.roots)
        roots = [r for r in roots if os.path.basename(r) in wanted or r in wanted]
    results = []
    summary_family = {}
    summary_scheme = {}
    mismatch_count = 0
    corrupt_count = 0
    from_cache = 0
    for root in sorted(roots):
        for path in files_cache.list_files(root, ext_filter=list(exts)):
            stat = os.stat(path)
            cached_before = not req.force and path in (model_probe.probe_cache or {})
            probe = model_probe.probe_file(path, use_cache=not req.force)
            from_cache += cached_before
            mismatches = audit_mismatches(path, root, probe) if probe.get("ok") else []
            mismatch_count += len(mismatches)
            corrupt_count += not probe.get("ok")
            arch = probe.get("arch", {})
            family = arch.get("family", "unknown")
            summary_family[family] = summary_family.get(family, 0) + 1
            scheme = probe.get("quant", {}).get("scheme")
            if scheme:
                summary_scheme[scheme] = summary_scheme.get(scheme, 0) + 1
            results.append({
                "path": path,
                "root": os.path.basename(root),
                "size": stat.st_size,
                "mtime": stat.st_mtime,
                "kind": arch.get("kind", "unknown"),
                "family": family,
                "display": arch.get("display", "Unknown"),
                "confidence": arch.get("confidence", 0.0),
                "variant": arch.get("variant"),
                "dominant_dtype": probe.get("dominant_dtype"),
                "quant": probe.get("quant"),
                "metadata_present": probe.get("metadata_present", False),
                "flags": probe.get("flags", []),
                "error": probe.get("error"),
                "mismatches": mismatches,
            })
    model_probe.save_probe_cache()
    total = len(results)
    if req.limit:
        results = results[req.offset:req.offset + req.limit]
    return {
        "files": results,
        "summary": {
            "by_family": summary_family,
            "by_scheme": summary_scheme,
            "mismatch_count": mismatch_count,
            "corrupt_count": corrupt_count,
        },
        "scanned": total,
        "from_cache": from_cache,
        "elapsed": round(time.time() - start, 3),
        "total": total,
    }


def audit_fix_plans(paths):
    """Renames correcting a trailing precision suffix token against probed
    truth. Only the suffix changes; canonical stems and role tokens stay."""
    import glob
    import re

    from modules import files_cache, model_probe
    from modules.civitai.filemanage_civitai import iter_type_roots

    try:
        from modules.api.security import is_confined_to
    except ImportError:
        from enso_api.security_stubs import is_confined_to
    roots = [str(r) for r in iter_type_roots()]
    if paths:
        candidates = [p for p in paths if is_confined_to(p, roots) and os.path.isfile(p)]
    else:
        candidates = [p for root in sorted(roots) for p in files_cache.list_files(root, ext_filter=[".safetensors"])]
    token_re = re.compile(rf"-({'|'.join(FILENAME_PRECISIONS)})$")
    plans = []
    for path in candidates:
        probe = model_probe.probe_file(path)
        if not probe.get("ok"):
            continue
        truth = model_probe.precision_token(probe)
        if not truth:
            continue
        stem, ext = os.path.splitext(os.path.basename(path))
        roles = ""
        for role in ROLE_NAME_SUFFIXES:
            if stem.endswith(f"-{role}"):
                stem = stem[: -len(role) - 1]
                roles = f"-{role}{roles}"
        m = token_re.search(stem)
        if not m or m.group(1) == truth:
            continue
        new_stem = f"{stem[: m.start()]}-{truth}{roles}"
        folder = os.path.dirname(path)
        old_stem = os.path.splitext(os.path.basename(path))[0]
        renames = []
        for comp in sorted(glob.glob(os.path.join(glob.escape(folder), glob.escape(old_stem) + ".*"))):
            target = os.path.join(folder, new_stem + os.path.basename(comp)[len(old_stem):])
            renames.append((comp, target))
        if any(os.path.exists(t) for _, t in renames):
            continue
        plans.append({"path": path, "to": new_stem + ext, "claimed": m.group(1), "actual": truth, "renames": renames})
    return plans


def post_audit_fix(req: ReqModelAuditFixV2):
    """
    Correct filename precision suffixes against probed truth.

    Dry-run by default: returns the rename plan. With ``apply`` set, performs
    the renames including same-stem sidecar files.
    """
    from modules import model_probe

    plans = audit_fix_plans(req.paths)
    if req.apply:
        for plan in plans:
            for src, dst in plan["renames"]:
                os.rename(src, dst)
        model_probe.save_probe_cache()
        log.info(f'Model audit fix: renamed={len(plans)}')
    return {
        "applied": req.apply,
        "count": len(plans),
        "renames": [
            {
                "path": p["path"],
                "to": p["to"],
                "claimed": p["claimed"],
                "actual": p["actual"],
                "files": [os.path.basename(s) for s, _ in p["renames"]],
            }
            for p in plans
        ],
    }


def post_metadata_scan():
    """
    Scan local models against CivitAI metadata.

    Checks all registered checkpoints for matching CivitAI entries and returns
    scan results with model ID, name, hash, versions, and status.
    """
    from modules.civitai import metadata_civitai

    results = []
    for batch in metadata_civitai.civit_search_metadata(raw=True):
        if isinstance(batch, list):
            results = batch
    return {"results": results}


def post_metadata_update():
    """
    Update local model metadata from CivitAI.

    Fetches the latest metadata from CivitAI for all matched models and updates
    local records. Returns per-model update results.
    """
    from modules.civitai import metadata_civitai

    items = []
    for batch in metadata_civitai.civit_update_metadata(raw=True):
        if isinstance(batch, list):
            items = batch
    results = []
    for item in items:
        results.append(
            {
                "file": getattr(item, "file", None),
                "id": getattr(item, "id", None),
                "name": getattr(item, "name", None),
                "sha": getattr(item, "sha", None),
                "versions": getattr(item, "versions", None),
                "latest": getattr(item, "latest_name", None),
                "status": getattr(item, "status", None),
            }
        )
    return {"results": results}


# ---------------------------------------------------------------------------
# - Merge & Replace
# ---------------------------------------------------------------------------


def get_merge_methods():
    """
    List available model merge methods and block-weight presets.

    Returns method names, which methods support beta/triple parameters,
    per-method documentation, and SD 1.5 / SDXL block-weight presets.
    """
    from modules.merging import merge_methods
    from modules.merging.merge_presets import BLOCK_WEIGHTS_PRESETS, SDXL_BLOCK_WEIGHTS_PRESETS
    from modules.merging.merge_utils import BETA_METHODS, TRIPLE_METHODS

    docs = {}
    for name in merge_methods.__all__:
        fn = getattr(merge_methods, name, None)
        docs[name] = (fn.__doc__ or "").strip() if fn else ""
    return {
        "methods": list(merge_methods.__all__),
        "beta_methods": list(BETA_METHODS),
        "triple_methods": list(TRIPLE_METHODS),
        "docs": docs,
        "presets": dict(BLOCK_WEIGHTS_PRESETS),
        "sdxl_presets": dict(SDXL_BLOCK_WEIGHTS_PRESETS),
    }


def post_merge(req: ReqMergeV2):
    """
    Merge two or three checkpoint models.

    Combines ``primary_model_name`` and ``secondary_model_name`` using the specified
    ``merge_mode``. Supports block-weight presets, precision control, re-basin
    alignment, and optional VAE bake-in. Saves the result as ``custom_name``.
    """
    from modules import errors, extras, sd_models

    if not req.custom_name:
        return {"status": "Error: no output model name specified"}
    if not req.primary_model_name or not req.secondary_model_name:
        return {"status": "Error: primary and secondary models are required"}
    kwargs = {k: v for k, v in req.model_dump().items() if v not in (None, "None", "", 0, [])}
    try:
        results = extras.run_modelmerger(None, **kwargs)
        status = results[-1] if isinstance(results, list) else str(results)
    except Exception as e:
        errors.display(e, "Merge")
        sd_models.list_models()
        status = f"Error merging: {e}"
    return {"status": status}


def post_replace(req: ReqReplaceV2):
    """
    Replace model components and save as a new model.

    Swap UNET, VAE, text encoders, scheduler, or fuse a LoRA into the base model.
    Saves the result as ``custom_name`` in Diffusers and/or safetensors format
    with optional metadata (author, version, license, description).
    """
    from modules import extras

    status = "Unknown"
    for msg in extras.run_model_modules(
        req.model_type,
        req.model_name,
        req.custom_name,
        req.comp_unet,
        req.comp_vae,
        req.comp_te1,
        req.comp_te2,
        req.precision,
        req.comp_scheduler,
        req.comp_prediction,
        req.comp_lora,
        req.comp_fuse,
        req.meta_author,
        req.meta_version,
        req.meta_license,
        req.meta_desc,
        req.meta_hint,
        None,  # meta_thumbnail (PIL image - not applicable via API)
        req.create_diffusers,
        req.create_safetensors,
        req.debug,
    ):
        status = msg
    return {"status": status}


# ---------------------------------------------------------------------------
# - Loader & Extract LoRA
# ---------------------------------------------------------------------------


def get_loader_pipelines():
    """
    List available pipeline types for the model loader.

    Returns pipeline class names (e.g., StableDiffusionPipeline, FluxPipeline)
    that can be used with the loader/components and loader/load endpoints.
    """
    from modules import shared_items

    names = list(shared_items.pipelines)
    names = ["Current" if x.startswith("Custom") else x for x in names]
    return {"pipelines": names}


def collect_loader_components(model_type: str) -> dict:
    """Populate ``ui_models_load.components`` for ``model_type`` and return the introspection payload.

    Shared by the /model/loader/components route and /model/loader/load,
    which needs the same setup before applying overrides.
    """
    import diffusers as _diffusers
    from modules import shared_items, ui_models_load

    if model_type == "Current":
        cls = shared.sd_model.__class__ if shared.sd_loaded else None
    else:
        cls = shared_items.pipelines.get(model_type, None)
    if cls is None:
        cls = _diffusers.AutoPipelineForText2Image
    name = cls.__name__
    repo = shared_items.get_repo(name) or shared_items.get_repo(model_type)
    ui_models_load.components.clear()
    signature = inspect.signature(cls.__init__, follow_wrapped=True)
    for param in signature.parameters.values():
        if param.name in ("self", "args", "kwargs"):
            continue
        component = ui_models_load.Component(param)
        ui_models_load.components.append(component)
    result = []
    for c in ui_models_load.components:
        result.append(
            {
                "id": c.id,
                "name": c.name,
                "loadable": c.loadable,
                "default": str(c.val) if c.val is not None else None,
                "class_name": c.str,
                "local": c.local,
                "remote": c.remote,
                "dtype": c.dtype,
                "quant": c.quant,
            }
        )
    return {"class": name, "repo": repo, "components": result}


def post_loader_components(req: ReqLoaderComponentsV2):
    """
    Inspect pipeline components for a given model type.

    Returns the pipeline class name, default HuggingFace repo, and a list of
    loadable components with their IDs, class names, local/remote paths,
    dtype, and quantization settings.
    """
    return collect_loader_components(req.model_type)


def post_loader_load(req: ReqLoaderLoadV2):
    """
    Load a model with custom component configuration.

    Loads the pipeline for ``model_type`` from ``repo``, optionally overriding
    individual component paths, dtypes, and quantization via the ``components`` list.
    Call loader/components first to discover available components.
    """
    from modules import ui_models_load

    cls_name = None
    if not ui_models_load.components:
        info = collect_loader_components(req.model_type)
        cls_name = info.get("class")
    if cls_name is None:
        import diffusers as _diffusers
        from modules import shared_items

        if req.model_type == "Current":
            cls = shared.sd_model.__class__ if shared.sd_loaded else None
        else:
            cls = shared_items.pipelines.get(req.model_type, None)
        if cls is None:
            cls = _diffusers.AutoPipelineForText2Image
        cls_name = cls.__name__
    if req.components:
        for comp in req.components:
            matches = [c for c in ui_models_load.components if c.id == comp.id]
            if not matches:
                continue
            c = matches[0]
            if comp.local is not None:
                c.local = comp.local.strip()
            if comp.remote is not None:
                c.remote = comp.remote.strip()
                if c.remote:
                    c.repo, c.subfolder, c.local, c.download = ui_models_load.process_huggingface_url(c.remote)
            if comp.dtype is not None:
                c.dtype = comp.dtype
            if comp.quant is not None:
                c.quant = comp.quant
    dataframes = [c.dataframe() for c in ui_models_load.components]
    result = ui_models_load.load_model(req.model_type, cls_name, req.repo, dataframes)
    return {"status": result}


def get_lora_loaded():
    """
    List LoRAs currently loaded in the active pipeline.

    Returns names of all LoRA networks that are fused or applied to the current model.
    """
    from modules.lora import lora_extract

    result = lora_extract.loaded_lora()
    if isinstance(result, str):
        return {"loras": []}
    return {"loras": result}


def post_lora_extract(req: ReqLoraExtractV2):
    """
    Extract a LoRA from the currently loaded model.

    Creates a LoRA file by comparing the current model weights against the base.
    ``max_rank`` controls decomposition rank, ``modules`` selects which parts
    to extract (defaults to ["te", "unet"]).
    """
    from modules.lora import lora_extract

    status = "Unknown"
    for msg in lora_extract.make_lora(req.filename, req.max_rank, req.auto_rank, req.rank_ratio, req.modules, req.overwrite):
        status = msg
    return {"status": status}


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


def register_api():
    api = shared.api
    #
    api.add_api_route("/sdapi/v2/model/analyze", get_analyze, methods=["GET"], tags=["Models"])
    api.add_api_route("/sdapi/v2/model/save", post_save, methods=["POST"], tags=["Models"])
    api.add_api_route("/sdapi/v2/model/list-detail", get_list_detail, methods=["GET"], tags=["Models"])
    api.add_api_route("/sdapi/v2/model/update-hashes", post_update_hashes, methods=["POST"], tags=["Models"])
    api.add_api_route("/sdapi/v2/model/probe", get_model_probe, methods=["GET"], tags=["Models"])
    api.add_api_route("/sdapi/v2/model/audit", post_model_audit, methods=["POST"], tags=["Models"])
    api.add_api_route("/sdapi/v2/model/audit/fix", post_audit_fix, methods=["POST"], tags=["Models"])
    #
    api.add_api_route("/sdapi/v2/model/hf/search", get_hf_search, methods=["GET"], tags=["Models"])
    api.add_api_route("/sdapi/v2/model/hf/download", post_hf_download, methods=["POST"], tags=["Models"])
    api.add_api_route("/sdapi/v2/model/civitai/download", post_civitai_download, methods=["POST"], tags=["Models"])
    api.add_api_route("/sdapi/v2/model/metadata/scan", post_metadata_scan, methods=["POST"], tags=["Models"])
    api.add_api_route("/sdapi/v2/model/metadata/update", post_metadata_update, methods=["POST"], tags=["Models"])
    #
    api.add_api_route("/sdapi/v2/model/merge/methods", get_merge_methods, methods=["GET"], tags=["Models"])
    api.add_api_route("/sdapi/v2/model/merge", post_merge, methods=["POST"], tags=["Models"])
    api.add_api_route("/sdapi/v2/model/replace", post_replace, methods=["POST"], tags=["Models"])
    #
    api.add_api_route("/sdapi/v2/model/loader/pipelines", get_loader_pipelines, methods=["GET"], tags=["Models"])
    api.add_api_route("/sdapi/v2/model/loader/components", post_loader_components, methods=["POST"], tags=["Models"])
    api.add_api_route("/sdapi/v2/model/loader/load", post_loader_load, methods=["POST"], tags=["Models"])
    api.add_api_route("/sdapi/v2/model/lora/loaded", get_lora_loaded, methods=["GET"], tags=["Models"])
    api.add_api_route("/sdapi/v2/model/lora/extract", post_lora_extract, methods=["POST"], tags=["Models"])
