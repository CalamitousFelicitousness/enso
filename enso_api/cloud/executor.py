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
``JobRequest`` / ``EXECUTORS``. cloud_tts, cloud_stt, cloud_video are
stubs until sdnext core ships ``modules.cloud.audio`` (Phase 4) and
``modules.cloud.video`` (Phase 3).
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
    has_image = bool(params.get("image"))

    width, height = parse_size(params.get("size"), params.get("width"), params.get("height"))
    init_image = resolve_ref(params.get("image"))
    mask = resolve_ref(params.get("mask"))

    log.info(f"Cloud: cloud_image executing job_id={job_id} provider={provider} model={model} {width}x{height} mode={'img2img' if has_image else 'txt2img'}")

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
            mask=mask,
            strength=params.get("strength") or 0.75,
            extra_params=params.get("extra_params") or None,
            save_to_disk=True,
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
    raise NotImplementedError("cloud_video executor stubbed; modules.cloud.video lands in Phase 3")
