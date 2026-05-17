"""V2 job-queue executor wiring for cloud job types.

Cloud generation primitives live in ``modules.cloud`` (sdnext core). The
V2 cloud worker (``ThreadPoolExecutor`` in ``enso_api.job_queue``) is a
sync thread, so it can call into ``modules.cloud.*`` directly with no
event-loop bridging. Each executor here translates the V2 request shape
(``enso_api.cloud.models.Cloud*Params``) to the kwargs the core entry
point expects, dispatches, then shapes the result into the V2 job-result
contract (``images`` / ``processed`` / ``info`` / ``params`` dict that
``serve_job_file`` reads).

cloud_chat is exposed via the V1 ``/sdapi/v1/cloud/prompt-enhance``
endpoint; the V2 job-type stub remains until removed from
``JobRequest`` / ``EXECUTORS``. cloud_tts and cloud_stt are stubs until
sdnext core ships ``modules.cloud.audio`` (Phase 4).
"""

import base64
import os
import time
from pathlib import Path

from modules.logger import log


def resolve_ref(ref):
    """Resolve a V2 image / mask ref to raw bytes.

    Supported forms:
    - ``upload:<id>`` — frontend-supplied reference from POST /sdapi/v2/upload
    - bare base64 string — direct embedding
    - bytes — passthrough
    - None / empty — returns None
    """
    if ref is None or ref == "":
        return None
    if isinstance(ref, bytes):
        return ref
    if isinstance(ref, str) and ref.startswith("upload:"):
        from enso_api.upload import get_upload_store

        ref_id = ref.split(":", 1)[1]
        entry = get_upload_store().get(ref_id)
        if entry is None:
            raise ValueError(f"Upload reference not found or expired: {ref}")
        return Path(entry.path).read_bytes()
    if isinstance(ref, str):
        return base64.b64decode(ref)
    raise TypeError(f"Unsupported ref type: {type(ref).__name__}")


def parse_size(size_str, fallback_width, fallback_height):
    """Parse a 'WxH' string. Falls back to the provided width/height or 1024x1024."""
    if isinstance(size_str, str) and "x" in size_str.lower():
        try:
            w_str, h_str = size_str.lower().split("x", 1)
            return int(w_str), int(h_str)
        except ValueError:
            pass
    return fallback_width or 1024, fallback_height or 1024


def make_progress_callback(job_id):
    """Build a sdnext-core progress callback that pushes to the V2 job WS.

    sdnext core emits ``{"phase": "..."}`` events; this wrapper stamps the
    V2 WS event type so the frontend's existing ``cloud_progress`` handler
    in ``useJobTracker`` lights up.
    """

    def on_progress(event: dict) -> None:
        from enso_api.job_queue import job_queue

        payload = {"type": "cloud_progress", **event}
        job_queue.push_progress(job_id, payload)

    return on_progress


def execute_cloud_image(params: dict, job_id: str) -> dict:
    from modules.cloud.errors import CloudError
    from modules.cloud.image import generate_image

    t0 = time.time()
    provider = params.get("provider", "")
    model = params.get("model", "")

    # SPEC §11.11.8 step 9: when the caller emits images: [...] (multi-image
    # Reference mode), resolve all refs to bytes and pass init_images list to
    # generate_image. When only the singular image is set (legacy Reference
    # fallback, current img2img path), keep the existing init_image kwarg
    # call - sdnext folds it into init_images=[init_image] per the alias.
    images_param = params.get("images")
    init_images = None
    if isinstance(images_param, list) and images_param:
        init_images = [resolve_ref(ref) for ref in images_param]
    init_image = resolve_ref(params.get("image"))
    has_any_image = bool(init_images) or bool(init_image)
    image_count = len(init_images) if init_images else (1 if init_image else 0)

    # SPEC §11.10.15: detect size="auto" before parse_size silently coerces it
    # to fallback dims. When auto, pass ask_auto=True with width/height=0
    # sentinels so generate_image's resolve_auto_dispatch can consult the
    # model's auto_wire and shape the adapter params accordingly. Explicit
    # WxH continues through the existing parse_size path.
    raw_size = params.get("size")
    ask_auto = isinstance(raw_size, str) and raw_size.strip().lower() == "auto"
    if ask_auto:
        width, height = 0, 0
    else:
        width, height = parse_size(raw_size, params.get("width"), params.get("height"))
    mask = resolve_ref(params.get("mask"))

    size_str = "auto" if ask_auto else f"{width}x{height}"
    mode_str = "img2img" if has_any_image else "txt2img"
    image_count_str = f" images={image_count}" if image_count > 1 else ""
    log.info(f"Cloud: cloud_image executing job_id={job_id} provider={provider} model={model} {size_str} mode={mode_str}{image_count_str}")

    try:
        result = generate_image(
            params.get("prompt", ""),
            provider,
            model,
            negative_prompt=params.get("negative_prompt") or "",
            width=width,
            height=height,
            n=params.get("n") or 1,
            seed=params.get("seed") if params.get("seed") is not None else -1,
            steps=params.get("steps") or 28,
            guidance_scale=params.get("guidance") or 7.5,
            quality=params.get("quality") or "standard",
            style=params.get("style"),
            init_image=init_image,
            init_images=init_images,
            mask=mask,
            strength=params.get("strength") or 0.75,
            extra_params=params.get("extra_params") or None,
            save_to_disk=True,
            ask_auto=ask_auto,
            on_progress=make_progress_callback(job_id),
        )
    except CloudError as e:
        log.error(f"Cloud: cloud_image failed job_id={job_id} provider={provider} model={model} time={time.time() - t0:.2f}s: {type(e).__name__}: {e}")
        raise

    images_refs = []
    for i, path in enumerate(result.saved_paths):
        ext = os.path.splitext(path)[1].lstrip(".").lower() or "png"
        try:
            file_size = os.path.getsize(path)
        except OSError:
            file_size = len(result.images[i]) if i < len(result.images) else 0
        images_refs.append(
            {
                "index": i,
                "path": path,
                "url": f"/sdapi/v2/jobs/{job_id}/images/{i}",
                "width": result.width,
                "height": result.height,
                "format": ext,
                "size": file_size,
            }
        )

    cost = result.usage.cost if result.usage else None
    log.info(f"Cloud: cloud_image done job_id={job_id} provider={provider} model={model} images={len(images_refs)} cost={cost} time={time.time() - t0:.2f}s")

    return {
        "images": images_refs,
        "processed": [],
        "info": {
            "cloud_provider": result.provider or provider,
            "cloud_model": result.model or model,
            "cloud_cost": cost,
            "revised_prompt": result.revised_prompt,
            "prompt": params.get("prompt"),
            "negative_prompt": params.get("negative_prompt"),
            "seed": result.seed,
            "width": result.width,
            "height": result.height,
        },
        "params": params,
    }


def execute_cloud_chat(params: dict, job_id: str) -> dict:
    raise NotImplementedError("cloud_chat is not exposed via the V2 job queue; use POST /sdapi/v1/cloud/prompt-enhance for the synchronous text surface")


def execute_cloud_tts(params: dict, job_id: str) -> dict:
    raise NotImplementedError("cloud_tts executor stubbed; modules.cloud.audio.tts lands in Phase 4")


def execute_cloud_stt(params: dict, job_id: str) -> dict:
    raise NotImplementedError("cloud_stt executor stubbed; modules.cloud.audio.stt lands in Phase 4")


def execute_cloud_video(params: dict, job_id: str) -> dict:
    from modules.cloud.errors import CloudError
    from modules.cloud.video import generate_video

    t0 = time.time()
    provider = params.get("provider", "")
    model = params.get("model", "")
    has_image = bool(params.get("image"))

    init_image = resolve_ref(params.get("image"))

    log.info(f"Cloud: cloud_video executing job_id={job_id} provider={provider} model={model} mode={'i2v' if has_image else 't2v'} duration={params.get('duration')} aspect={params.get('aspect_ratio')} size={params.get('size')}")

    try:
        result = generate_video(
            params.get("prompt", ""),
            provider,
            model,
            aspect_ratio=params.get("aspect_ratio"),
            duration=params.get("duration"),
            size=params.get("size"),
            init_image=init_image,
            seed=params.get("seed") if params.get("seed") is not None else -1,
            extra_params=params.get("extra_params") or None,
            save_to_disk=True,
            on_progress=make_progress_callback(job_id),
        )
    except CloudError as e:
        log.error(f"Cloud: cloud_video failed job_id={job_id} provider={provider} model={model} time={time.time() - t0:.2f}s: {type(e).__name__}: {e}")
        raise

    videos_refs: list[dict] = []
    if result.saved_path:
        # sdnext's modules.cloud.video.write_thumbnail writes the PNG to
        # <video_path>.thumb.png; reference that path directly so the
        # /thumbnail subroute can serve it under the same path-confinement.
        thumb_path: str | None = f"{result.saved_path}.thumb.png" if result.thumbnail else None
        try:
            file_size = os.path.getsize(result.saved_path)
        except OSError:
            file_size = len(result.video) if result.video else 0
        if thumb_path and not os.path.isfile(thumb_path):
            thumb_path = None
        videos_refs.append(
            {
                "index": 0,
                "path": result.saved_path,
                "thumbnail_path": thumb_path,
                "url": f"/sdapi/v2/jobs/{job_id}/videos/0",
                "thumbnail_url": f"/sdapi/v2/jobs/{job_id}/videos/0/thumbnail" if thumb_path else None,
                "format": result.format,
                "size": file_size,
                "duration": result.duration,
            }
        )

    cost = result.usage.cost if result.usage else None
    log.info(f"Cloud: cloud_video done job_id={job_id} provider={provider} model={model} videos={len(videos_refs)} cost={cost} time={time.time() - t0:.2f}s")

    return {
        "videos": videos_refs,
        "info": {
            "cloud_provider": result.provider or provider,
            "cloud_model": result.model or model,
            "cloud_cost": cost,
            "prompt": params.get("prompt"),
            "seed": result.seed,
            "duration": result.duration,
            "aspect_ratio": params.get("aspect_ratio"),
            "size": params.get("size"),
            "format": result.format,
            "is_i2v": has_image,
        },
        "params": params,
    }
