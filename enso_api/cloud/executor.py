"""Cloud job executors and async thread pool setup.

Each executor bridges the sync job queue worker thread to the async adapter
by dispatching the coroutine to FastAPI's main event loop via
run_coroutine_threadsafe. This is required because httpx.AsyncClient's
internal primitives bind to the loop that first uses them (FastAPI's loop,
via provider routes), so all subsequent cloud I/O must run on the same loop.
"""

import asyncio
import time
from collections.abc import Coroutine
from typing import Any

from modules.logger import log

from enso_api.cloud.protocol import ProgressCallback


def _dispatch(coro: Coroutine[Any, Any, dict]) -> dict:
    from enso_api.cloud import get_main_loop

    loop = get_main_loop()
    if loop is None or not loop.is_running():
        raise RuntimeError("Cloud main event loop not captured. The FastAPI server must serve at least one /sdapi/v2/cloud/* request before a cloud job can run.")
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    return future.result()


def _make_progress_callback(job_id: str) -> ProgressCallback:
    def on_progress(data: dict):
        from enso_api.job_queue import job_queue

        job_queue.push_progress(job_id, data)

    return on_progress


def execute_cloud_image(params: dict, job_id: str) -> dict:
    return _dispatch(_async_cloud_image(params, job_id))


async def _async_cloud_image(params: dict, job_id: str) -> dict:
    from enso_api.cloud import get_adapter

    adapter = get_adapter(params["provider"])
    on_progress = _make_progress_callback(job_id)

    t0 = time.time()
    try:
        result = await adapter.generate_image(params, on_progress)
        saved = _save_image_result(result, job_id, params)
        cost = result.usage.cost if result.usage else None
        log.info(f"Cloud: job done type=image job_id={job_id} provider={params.get('provider')} model={params.get('model')} images={len(saved.get('images', []))} cost={cost} time={time.time() - t0:.2f}s")
        return saved
    except Exception as e:
        log.error(f"Cloud: job failed type=image job_id={job_id} provider={params.get('provider')} model={params.get('model')} time={time.time() - t0:.2f}s: {type(e).__name__}: {e}")
        raise


def execute_cloud_chat(params: dict, job_id: str) -> dict:
    return _dispatch(_async_cloud_chat(params, job_id))


async def _async_cloud_chat(params: dict, job_id: str) -> dict:
    from enso_api.cloud import get_adapter

    adapter = get_adapter(params["provider"])
    on_progress = _make_progress_callback(job_id)

    t0 = time.time()
    try:
        result = await adapter.chat(params, on_progress)
    except Exception as e:
        log.error(f"Cloud: job failed type=chat job_id={job_id} provider={params.get('provider')} model={params.get('model')} time={time.time() - t0:.2f}s: {type(e).__name__}: {e}")
        raise
    cost = result.usage.cost if result.usage else None
    log.info(f"Cloud: job done type=chat job_id={job_id} provider={params.get('provider')} model={params.get('model')} chars={len(result.content or '')} finish={result.finish_reason} cost={cost} time={time.time() - t0:.2f}s")
    return {
        "images": [],
        "processed": [],
        "info": {
            "cloud_provider": params.get("provider"),
            "cloud_model": params.get("model"),
            "cloud_cost": cost,
        },
        "params": params,
        "text": result.content,
        "tool_calls": result.tool_calls,
        "finish_reason": result.finish_reason,
        "usage": vars(result.usage) if result.usage else None,
    }


def execute_cloud_tts(params: dict, job_id: str) -> dict:
    return _dispatch(_async_cloud_tts(params, job_id))


async def _async_cloud_tts(params: dict, job_id: str) -> dict:
    from enso_api.cloud import get_adapter

    adapter = get_adapter(params["provider"])

    t0 = time.time()
    try:
        result = await adapter.tts(params)
    except Exception as e:
        log.error(f"Cloud: job failed type=tts job_id={job_id} provider={params.get('provider')} model={params.get('model')} time={time.time() - t0:.2f}s: {type(e).__name__}: {e}")
        raise
    audio_path = _save_audio_result(result, job_id)
    log.info(f"Cloud: job done type=tts job_id={job_id} provider={params.get('provider')} model={params.get('model')} bytes={len(result.data)} duration={result.duration} time={time.time() - t0:.2f}s")
    return {
        "images": [],
        "processed": [],
        "info": {
            "cloud_provider": params.get("provider"),
            "cloud_model": params.get("model"),
        },
        "params": params,
        "audio": {
            "url": f"/sdapi/v2/jobs/{job_id}/audio",
            "format": result.format,
            "duration": result.duration,
            "size": len(result.data),
            "path": audio_path,
        },
    }


def execute_cloud_stt(params: dict, job_id: str) -> dict:
    return _dispatch(_async_cloud_stt(params, job_id))


async def _async_cloud_stt(params: dict, _job_id: str) -> dict:
    from enso_api.cloud import get_adapter

    adapter = get_adapter(params["provider"])

    t0 = time.time()
    try:
        result = await adapter.transcribe(params)
    except Exception as e:
        log.error(f"Cloud: job failed type=stt job_id={_job_id} provider={params.get('provider')} model={params.get('model')} time={time.time() - t0:.2f}s: {type(e).__name__}: {e}")
        raise
    log.info(f"Cloud: job done type=stt job_id={_job_id} provider={params.get('provider')} model={params.get('model')} chars={len(result.text or '')} language={result.language} time={time.time() - t0:.2f}s")
    return {
        "images": [],
        "processed": [],
        "info": {
            "cloud_provider": params.get("provider"),
            "cloud_model": params.get("model"),
        },
        "params": params,
        "text": result.text,
        "language": result.language,
        "segments": result.segments,
        "duration": result.duration,
    }


def execute_cloud_video(params: dict, job_id: str) -> dict:
    return _dispatch(_async_cloud_video(params, job_id))


async def _async_cloud_video(params: dict, job_id: str) -> dict:
    from enso_api.cloud import get_adapter

    adapter = get_adapter(params["provider"])
    on_progress = _make_progress_callback(job_id)

    t0 = time.time()
    try:
        result = await adapter.generate_video(params, on_progress)
    except Exception as e:
        log.error(f"Cloud: job failed type=video job_id={job_id} provider={params.get('provider')} model={params.get('model')} time={time.time() - t0:.2f}s: {type(e).__name__}: {e}")
        raise
    video_path = _save_video_result(result, job_id)
    log.info(f"Cloud: job done type=video job_id={job_id} provider={params.get('provider')} model={params.get('model')} bytes={len(result.data)} duration={result.duration} time={time.time() - t0:.2f}s")
    return {
        "images": [],
        "processed": [],
        "info": {
            "cloud_provider": params.get("provider"),
            "cloud_model": params.get("model"),
        },
        "params": params,
        "video": {
            "url": f"/sdapi/v2/jobs/{job_id}/video",
            "format": result.format,
            "duration": result.duration,
            "size": len(result.data),
            "path": video_path,
        },
    }


# --- Result storage helpers ---


def _build_pnginfo(result, params: dict) -> str:
    # Match SD.Next's PNG `parameters` chunk shape so the gallery info dialog and
    # any external PNG-info parser can extract these fields. First line is the
    # prompt, second is the negative prompt, third is the comma-separated key-value
    # block. Cloud-specific keys are namespaced with "Cloud " to make their origin
    # obvious.
    prompt = params.get("prompt", "") or ""
    negative = params.get("negative_prompt", "") or ""
    cost = result.usage.cost if result.usage else None
    parts = [
        f"Cloud provider: {params.get('provider')}",
        f"Cloud model: {params.get('model')}",
    ]
    if params.get("seed") is not None:
        parts.append(f"Seed: {params['seed']}")
    if params.get("width") and params.get("height"):
        parts.append(f"Size: {params['width']}x{params['height']}")
    if cost is not None:
        parts.append(f"Cloud cost: {cost}")
    if result.revised_prompt:
        parts.append(f"Revised prompt: {result.revised_prompt}")
    return f"{prompt}\nNegative prompt: {negative}\n{', '.join(parts)}"


def _save_image_result(result, job_id: str, params: dict) -> dict:
    import io

    from modules import images as img_module
    from modules import shared
    from modules.paths import resolve_output_path
    from PIL import Image

    has_image = bool(params.get("image"))
    output_dir = resolve_output_path(
        shared.opts.outdir_samples,
        shared.opts.outdir_img2img_samples if has_image else shared.opts.outdir_txt2img_samples,
    )
    pnginfo = _build_pnginfo(result, params)

    images = []
    for i, img_bytes in enumerate(result.images):
        pil_img = Image.open(io.BytesIO(img_bytes))
        pil_img.load()
        # save_image returns (image_path, txt_sidecar_path, exifinfo). Inherits
        # SD.Next's FilenameGenerator, save_to_dirs, gallery cache registration, and
        # writes the PNG parameters chunk so cloud results are indistinguishable
        # from local ones.
        path_info = img_module.save_image(
            pil_img,
            output_dir,
            "",
            seed=params.get("seed", -1),
            prompt=params.get("prompt", ""),
            info=pnginfo,
        )
        image_path = path_info[0] if isinstance(path_info, (list, tuple)) and path_info else None
        if not image_path:
            continue
        import os

        images.append(
            {
                "index": i,
                "path": image_path,
                "url": f"/sdapi/v2/jobs/{job_id}/images/{i}",
                "width": pil_img.width,
                "height": pil_img.height,
                "format": os.path.splitext(image_path)[1].lstrip(".").lower() or "png",
                "size": os.path.getsize(image_path),
            }
        )

    return {
        "images": images,
        "processed": [],
        "info": {
            "cloud_provider": params.get("provider"),
            "cloud_model": params.get("model"),
            "cloud_cost": result.usage.cost if result.usage else None,
            "revised_prompt": result.revised_prompt,
            "prompt": params.get("prompt"),
            "negative_prompt": params.get("negative_prompt"),
            "seed": params.get("seed"),
            "width": params.get("width"),
            "height": params.get("height"),
        },
        "params": params,
    }


def _save_audio_result(result, job_id: str) -> str:
    # SD.Next doesn't ship an outdir option for audio; fall back to outdir_samples
    # so it lives alongside other generated artifacts.
    import os

    from modules import shared

    output_dir = shared.opts.outdir_samples or shared.opts.outdir_txt2img_samples
    os.makedirs(output_dir, exist_ok=True)
    filepath = os.path.join(output_dir, f"cloud_{job_id}.{result.format}")
    with open(filepath, "wb") as f:
        f.write(result.data)
    return filepath


def _save_video_result(result, job_id: str) -> str:
    import os

    from modules import shared

    output_dir = shared.opts.outdir_video or shared.opts.outdir_samples
    os.makedirs(output_dir, exist_ok=True)
    filepath = os.path.join(output_dir, f"cloud_{job_id}.{result.format}")
    with open(filepath, "wb") as f:
        f.write(result.data)
    return filepath
