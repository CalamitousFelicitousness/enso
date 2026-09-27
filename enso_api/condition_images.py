"""Several input images passed to a multi-image model as one condition set.

sdnext loaders declare ``max_condition_images`` on pipelines that take a flat
image list as one set shared by every sample; for any other pipeline a list in
``inputs`` means one image per run. ``skip_processing`` sends ``inputs`` to the
pipeline without server preprocessing, which is how several canvas inputs
reach such a model.
"""

import math

# Pipelines known to take a flat image list as one set, for sdnext builds whose
# loader does not declare max_condition_images. An entry goes once it does.
FALLBACK_CAPACITY: dict[str, int] = {
    "QwenImage21Pipeline": 10,
    "QwenImageEditPlusPipeline": 3,
}

MODEL_AXIS = "[Model] Model"


class InputImagesError(ValueError):
    """Request rejected before any work; the job queue logs it without a traceback."""

    code = 400


def declared_capacity(model) -> int:
    return int(getattr(model, "max_condition_images", 0) or 0)


def max_condition_images(model) -> int:
    """Input images the pipeline takes as one set; 1 for single-image models."""
    if model is None:
        return 1
    return declared_capacity(model) or FALLBACK_CAPACITY.get(type(model).__name__, 1)


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


def validate_grid(params: dict, model) -> None:
    """Reject an XYZ grid over several unprocessed inputs that would not run once per cell."""
    if not params.get("skip_processing") or len(params.get("inputs") or []) < 2:
        return
    axes = [(params.get(key) or {}).get("type") for key in ("x_axis", "y_axis", "z_axis")]
    if MODEL_AXIS in axes:
        raise InputImagesError("an XYZ grid with several input images cannot switch models per cell")
    if not declared_capacity(model):
        # control_run leaves its per-input loop when restore_pipeline clears the
        # pipeline, which processing skips under xyz: the grid would run per input
        raise InputImagesError(f"an XYZ grid with several input images is not supported for {type(model).__name__} on this SD.Next build")


def fit_first_input(image, width: int, height: int, model):
    """image resized to width x height, aligned to sdnext's init-image multiple.

    Interim for pipelines that do not declare max_condition_images. For those,
    modules/processing_helpers.resize_init_images stretches images[1:] to
    image[0]'s aligned size, and the pipeline call is sized from image[0] while
    decode uses the request size. An image[0] at the aligned request size, sent
    as the request size, avoids both. An image[0] of another shape would have to
    be distorted, so the request is rejected instead. Remove once the supported
    sdnext builds declare the limit for every pipeline in FALLBACK_CAPACITY.
    """
    from modules import images, sd_vae

    multiple = sd_vae.get_vae_scale_factor(model, init_image=True)
    if abs(image.height * width / image.width - height) >= multiple:
        raise InputImagesError(
            f"{type(model).__name__} on this SD.Next build takes the output size from the first input image, and its {image.width}x{image.height} is not the shape of the requested {width}x{height}; pick Input 1 in Size from, or update SD.Next"
        )
    size = (multiple * math.ceil(width / multiple), multiple * math.ceil(height / multiple))
    if image.size == size:
        return image
    return images.resize_image(1, image, *size, upscaler_name=None)
