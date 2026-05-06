"""Job-type discovery for the v2 API.

Walks the JobRequest discriminated union to project a presentation-friendly
list for `GET /sdapi/v2/job-types`. Holds per-type display metadata
(title, category) that is not derivable from the Pydantic schema.

Adding a new job type means three coordinated edits:
  1. New leaf class with a ``type: Literal[...]`` field in
     ``enso_api/job_models.py`` (or ``enso_api/cloud/models.py``) and append
     to the ``JobRequest`` union.
  2. Register the executor entry in ``enso_api.executors.EXECUTORS``.
  3. Add a corresponding entry to ``JOB_TYPE_META`` below.

The startup invariant ``validate_registries()`` enforces all three are in
sync -- missing any will raise ``RuntimeError`` at ``register_api()`` time
so drift fails fast on app boot rather than as a 500 on the first bad
client submit (the existing ``routes.py`` per-request guard remains as a
defense in depth).

Note on rembg: it is currently categorized as ``model-management`` because
that is the file section it sits in (``job_models.py:916``, just below the
``# --- Model management job types ---`` header). It is logically a
post-processing / image-ops operation and is a known mis-fit; the fix is
to relocate ``RembgParams`` to its own section in ``job_models.py`` and
update the category here in the same change. Tracked separately to keep
this module focused on discovery.
"""

from typing import Optional, get_args
import inspect

from enso_api.job_models import JobRequest


JOB_TYPE_META: dict[str, dict[str, str]] = {
    "generate":      {"title": "Generate",              "category": "core"},
    "upscale":       {"title": "Upscale",               "category": "core"},
    "caption":       {"title": "Caption",               "category": "core"},
    "enhance":       {"title": "Prompt Enhance",        "category": "core"},
    "detect":        {"title": "Detect",                "category": "core"},
    "preprocess":    {"title": "Preprocess",            "category": "core"},
    "detail":        {"title": "Detailer-only",         "category": "core"},
    "xyz-grid":      {"title": "XYZ Grid",              "category": "core"},
    "video":         {"title": "Video (Native)",        "category": "video"},
    "framepack":     {"title": "Video (FramePack)",     "category": "video"},
    "ltx":           {"title": "Video (LTX)",           "category": "video"},
    "model-load":    {"title": "Load Checkpoint",       "category": "model-management"},
    "model-merge":   {"title": "Merge Checkpoints",     "category": "model-management"},
    "model-replace": {"title": "Replace Components",    "category": "model-management"},
    "model-save":    {"title": "Save Model",            "category": "model-management"},
    "loader-load":   {"title": "Custom Loader",         "category": "model-management"},
    "lora-extract":  {"title": "Extract LoRA",          "category": "model-management"},
    "hf-download":   {"title": "HuggingFace Download",  "category": "model-management"},
    "rembg":         {"title": "Background Remove",     "category": "model-management"},
    "cloud_image":   {"title": "Cloud: Image",          "category": "cloud"},
    "cloud_chat":    {"title": "Cloud: Chat",           "category": "cloud"},
    "cloud_tts":     {"title": "Cloud: Text-to-Speech", "category": "cloud"},
    "cloud_stt":     {"title": "Cloud: Speech-to-Text", "category": "cloud"},
    "cloud_video":   {"title": "Cloud: Video",          "category": "cloud"},
}


def union_variants() -> list[type]:
    """Extract leaf Pydantic classes from the JobRequest discriminated union.

    JobRequest = Annotated[Union[...], Field(discriminator="type")] -- so we
    unwrap two levels via typing.get_args.
    """
    union_alias = get_args(JobRequest)[0]
    return list(get_args(union_alias))


def extract_extends(cls: type) -> Optional[str]:
    """Return the parent type's discriminator if cls extends another union member.

    Walks ``cls.__mro__[1:]`` for the first ancestor with its own Literal
    ``type`` default. Currently only ``XyzGridParams(GenerateParams)`` ->
    ``'generate'``; every other variant returns ``None``.
    """
    for base in cls.__mro__[1:]:
        fields = getattr(base, "model_fields", None)
        if not fields or "type" not in fields:
            continue
        default = fields["type"].default
        if isinstance(default, str):
            return default
    return None


def discover_job_types() -> list:
    """Project the union into ItemJobTypeV2 records for the discovery endpoint."""
    from enso_api.executors import EXECUTORS
    from enso_api.models import ItemJobTypeV2
    items = []
    for cls in union_variants():
        t = cls.model_fields["type"].default
        meta = JOB_TYPE_META[t]
        entry = EXECUTORS[t]
        items.append(ItemJobTypeV2(
            type=t,
            title=meta["title"],
            description=inspect.cleandoc(cls.__doc__ or ""),
            category=meta["category"],
            runtime="local" if entry["lock"] else "cloud",
            interruptible=bool(entry["lock"]),
            extends=extract_extends(cls),
            schema_ref=f"#/components/schemas/{cls.__name__}",
        ))
    return items


def validate_registries() -> None:
    """Startup invariant -- raise RuntimeError if union, EXECUTORS, and meta diverge.

    Promotes the ``routes.py`` runtime drift guard into a fail-fast boot
    check: a job type added to one registry without the other two will
    abort ``register_api()`` with a stack trace pointing at the missing
    keys, rather than surfacing as a confusing 500 on the first client
    submission.
    """
    from enso_api.executors import EXECUTORS
    union_keys = {c.model_fields["type"].default for c in union_variants()}
    exec_keys = set(EXECUTORS.keys())
    meta_keys = set(JOB_TYPE_META.keys())
    if union_keys == exec_keys == meta_keys:
        return
    raise RuntimeError(
        "Enso API job-type registry drift: "
        f"union={sorted(union_keys)}, "
        f"executors={sorted(exec_keys)}, "
        f"meta={sorted(meta_keys)}; "
        f"union-executors={sorted(union_keys - exec_keys)}, "
        f"executors-union={sorted(exec_keys - union_keys)}, "
        f"meta-union={sorted(meta_keys - union_keys)}, "
        f"union-meta={sorted(union_keys - meta_keys)}"
    )
