"""Shared helpers for the Enso API."""

import io
import os


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
