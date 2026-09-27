"""Several input images passed to a multi-image model as one condition set.

sdnext loaders declare ``max_condition_images`` on pipelines that take a flat
image list as one set shared by every sample; for any other pipeline a list in
``inputs`` means one image per run. ``skip_processing`` sends ``inputs`` to the
pipeline without server preprocessing, which is how several canvas inputs
reach such a model.
"""

MODEL_AXIS = "[Model] Model"


class InputImagesError(ValueError):
    """Request rejected before any work; the job queue logs it without a traceback."""

    code = 400


def max_condition_images(model) -> int:
    """Input images the pipeline takes as one set; 1 for single-image models."""
    return int(getattr(model, "max_condition_images", None) or 1)


def skipped_settings(params: dict) -> list[str]:
    """Settings a skip_processing job would ignore, or apply to the output without the other inputs."""
    extra = params.get("extra") or {}
    checks = (
        ("inpaint mask", bool(params.get("mask"))),
        ("separate init images", bool(params.get("inits"))),
        ("resize before", params.get("resize_mode_before", 0) != 0),
        ("control units", bool(params.get("control"))),
        ("IP-Adapter", bool(params.get("ip_adapter"))),
        ("batch size above 1", params.get("batch_size", 1) > 1),
        ("hires fix", bool(params.get("enable_hr"))),
        ("refiner", params.get("refiner_steps", 0) > 0 or params.get("refiner_start", 0) > 0),
        ("detailer", bool(params.get("detailer_enabled"))),
        ("color correction", bool(params.get("img2img_color_correction"))),
        ("checkpoint override", bool(extra.get("sd_model_checkpoint"))),
    )
    return [label for label, hit in checks if hit]


def validate(params: dict, model) -> None:
    """Reject a skip_processing job the loaded pipeline cannot run as sent."""
    if not params.get("skip_processing"):
        return
    problems = []
    count = len(params.get("inputs") or [])
    capacity = max_condition_images(model)
    if count > capacity:
        noun = "image" if capacity == 1 else "images"
        problems.append(f"{type(model).__name__} takes {capacity} input {noun}, got {count}")
    skipped = skipped_settings(params)
    if skipped:
        problems.append(f"not applied to unprocessed inputs: {', '.join(skipped)}")
    if problems:
        raise InputImagesError("; ".join(problems))


def validate_grid(params: dict) -> None:
    """Reject an XYZ grid over several unprocessed inputs whose cells switch models."""
    if not params.get("skip_processing") or len(params.get("inputs") or []) < 2:
        return
    axes = [(params.get(key) or {}).get("type") for key in ("x_axis", "y_axis", "z_axis")]
    if MODEL_AXIS in axes:
        raise InputImagesError("an XYZ grid with several input images cannot switch models per cell")
