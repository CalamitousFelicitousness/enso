"""Shared helpers for the Enso API."""

import io
import os


def job_progress(state, status) -> tuple[float, float | None]:
    """Progress and ETA of the running job.

    sdnext keeps one job slot, and a nested task's end() clears its job counters.
    On models that encode inside the pipeline call that leaves status.progress at
    0 for the whole denoising loop, so sampling steps carry it instead, timed from
    that end(), which also resets time_start.
    """
    progress = getattr(status, "progress", 0) or 0
    eta = getattr(status, "eta", None)
    if getattr(status, "jobs", 0) == 0 and state.sampling_steps > 0:
        progress = round(min(1, max(state.sampling_step, 0) / state.sampling_steps), 2)
        elapsed = getattr(status, "elapsed", None)
        eta = round(elapsed / progress - elapsed, 2) if progress > 0 and elapsed else None
    return progress, eta


def preview_image(image) -> bytes:
    """Live preview bytes: WebP when some pixels are transparent, which JPEG cannot store; JPEG otherwise."""
    buf = io.BytesIO()
    if image.has_transparency_data:
        rgba = image.convert("RGBA")
        if rgba.getchannel("A").getextrema()[0] < 255:
            # Defaults spend 8x the time on lossless alpha; lossy alpha costs 0.2% mean error
            rgba.save(buf, format="WEBP", quality=75, method=0, alpha_quality=50)
            return buf.getvalue()
        image = rgba
    (image if image.mode == "RGB" else image.convert("RGB")).save(buf, format="JPEG", quality=75)
    return buf.getvalue()


def is_model_cached(repo_id: str) -> bool:
    """Check if a HuggingFace model repo exists in the local cache."""
    if not repo_id:
        return False
    from modules import shared

    cache_folder = "models--" + repo_id.replace("/", "--")
    return any(os.path.isdir(os.path.join(cache_dir, cache_folder, "snapshots")) for cache_dir in [shared.opts.hfcache_dir, shared.opts.diffusers_dir])
