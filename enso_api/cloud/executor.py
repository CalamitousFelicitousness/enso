"""Cloud job executors and async thread pool setup.

Each executor bridges the sync job queue worker thread to the async adapter.
Cloud worker threads maintain a persistent event loop for efficient connection reuse.
"""

import asyncio
import threading

from enso_api.cloud.protocol import ProgressCallback

_thread_loops: dict[int, asyncio.AbstractEventLoop] = {}
_loops_lock = threading.Lock()


def _get_thread_event_loop() -> asyncio.AbstractEventLoop:
    tid = threading.current_thread().ident
    with _loops_lock:
        if tid in _thread_loops:
            return _thread_loops[tid]
        loop = asyncio.new_event_loop()
        _thread_loops[tid] = loop
        return loop


def _make_progress_callback(job_id: str) -> ProgressCallback:
    def on_progress(data: dict):
        from enso_api.job_queue import job_queue
        job_queue.push_progress(job_id, data)
    return on_progress


def execute_cloud_image(params: dict, job_id: str) -> dict:
    loop = _get_thread_event_loop()
    return loop.run_until_complete(_async_cloud_image(params, job_id))


async def _async_cloud_image(params: dict, job_id: str) -> dict:
    from enso_api.cloud import get_adapter
    adapter = get_adapter(params["provider"])
    on_progress = _make_progress_callback(job_id)

    result = await adapter.generate_image(params, on_progress)
    return _save_image_result(result, job_id, params)


def execute_cloud_chat(params: dict, job_id: str) -> dict:
    loop = _get_thread_event_loop()
    return loop.run_until_complete(_async_cloud_chat(params, job_id))


async def _async_cloud_chat(params: dict, job_id: str) -> dict:
    from enso_api.cloud import get_adapter
    adapter = get_adapter(params["provider"])
    on_progress = _make_progress_callback(job_id)

    result = await adapter.chat(params, on_progress)
    return {
        "images": [],
        "processed": [],
        "info": {
            "cloud_provider": params.get("provider"),
            "cloud_model": params.get("model"),
            "cloud_cost": result.usage.cost if result.usage else None,
        },
        "params": params,
        "text": result.content,
        "tool_calls": result.tool_calls,
        "finish_reason": result.finish_reason,
        "usage": vars(result.usage) if result.usage else None,
    }


def execute_cloud_tts(params: dict, job_id: str) -> dict:
    loop = _get_thread_event_loop()
    return loop.run_until_complete(_async_cloud_tts(params, job_id))


async def _async_cloud_tts(params: dict, job_id: str) -> dict:
    from enso_api.cloud import get_adapter
    adapter = get_adapter(params["provider"])

    result = await adapter.tts(params)
    audio_path = _save_audio_result(result, job_id)
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
    loop = _get_thread_event_loop()
    return loop.run_until_complete(_async_cloud_stt(params, job_id))


async def _async_cloud_stt(params: dict, _job_id: str) -> dict:
    from enso_api.cloud import get_adapter
    adapter = get_adapter(params["provider"])

    result = await adapter.transcribe(params)
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
    loop = _get_thread_event_loop()
    return loop.run_until_complete(_async_cloud_video(params, job_id))


async def _async_cloud_video(params: dict, job_id: str) -> dict:
    from enso_api.cloud import get_adapter
    adapter = get_adapter(params["provider"])
    on_progress = _make_progress_callback(job_id)

    result = await adapter.generate_video(params, on_progress)
    video_path = _save_video_result(result, job_id)
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

def _get_output_dir(job_id: str) -> str:
    import os
    from enso_api.job_queue import job_queue
    base = os.path.dirname(job_queue.store.db_path) if job_queue.store else "."
    output_dir = os.path.join(base, "outputs", job_id)
    os.makedirs(output_dir, exist_ok=True)
    return output_dir


def _save_image_result(result, job_id: str, params: dict) -> dict:
    import os
    output_dir = _get_output_dir(job_id)
    images = []
    fmt = result.format or "png"

    for i, img_bytes in enumerate(result.images):
        filename = f"{i:04d}.{fmt}"
        filepath = os.path.join(output_dir, filename)
        with open(filepath, "wb") as f:
            f.write(img_bytes)
        images.append({
            "index": i,
            "url": f"/sdapi/v2/jobs/{job_id}/images/{i}",
            "width": params.get("width", 0),
            "height": params.get("height", 0),
            "format": fmt,
            "size": len(img_bytes),
        })

    return {
        "images": images,
        "processed": [],
        "info": {
            "cloud_provider": params.get("provider"),
            "cloud_model": params.get("model"),
            "cloud_cost": result.usage.cost if result.usage else None,
            "revised_prompt": result.revised_prompt,
            "prompt": params.get("prompt"),
            "negative_prompt": params.get("negative_prompt") or params.get("negativePrompt"),
            "seed": params.get("seed"),
            "width": params.get("width"),
            "height": params.get("height"),
        },
        "params": params,
    }


def _save_audio_result(result, job_id: str) -> str:
    import os
    output_dir = _get_output_dir(job_id)
    filename = f"audio.{result.format}"
    filepath = os.path.join(output_dir, filename)
    with open(filepath, "wb") as f:
        f.write(result.data)
    return filepath


def _save_video_result(result, job_id: str) -> str:
    import os
    output_dir = _get_output_dir(job_id)
    filename = f"video.{result.format}"
    filepath = os.path.join(output_dir, filename)
    with open(filepath, "wb") as f:
        f.write(result.data)
    return filepath
