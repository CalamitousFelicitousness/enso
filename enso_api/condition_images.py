"""Input images passed to a multi-image model as one condition set.

sdnext loaders declare ``max_condition_images`` on pipelines that take a flat
image list as one set shared by every sample; for any other pipeline a list in
``inputs`` means one image per run. ``skip_processing`` sends ``inputs`` to the
pipeline without server preprocessing, which is how canvas inputs reach such a
model as a set, and how a single one keeps the requested output size.
"""

MODEL_AXIS = "[Model] Model"


class InputImagesError(ValueError):
    """Request rejected before any work; the job queue logs it without a traceback."""

    code = 400


def max_condition_images(model) -> int:
    """Input images the pipeline takes as one set; 1 for single-image models."""
    return int(getattr(model, "max_condition_images", None) or 1)


def request_sets_size(model) -> bool:
    """The pipeline declares its condition images, so the request sets its output size."""
    return int(getattr(model, "max_condition_images", None) or 0) > 0


def skipped_settings(params: dict) -> list[str]:
    """Settings that apply only to a processed input, which a skip_processing job does not have."""
    extra = params.get("extra") or {}
    checks = (
        ("inpaint mask", bool(params.get("mask"))),
        ("separate init images", bool(params.get("inits"))),
        ("resize before", params.get("resize_mode_before", 0) != 0),
        ("control units", bool(params.get("control"))),
        ("IP-Adapter", bool(params.get("ip_adapter"))),
        ("batch size above 1", params.get("batch_size", 1) > 1),
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
