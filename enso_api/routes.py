import asyncio
import json
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from modules.logger import log

from enso_api.job_models import JobRequest
from enso_api.models import (
    FramePackLoadResponse,
    JobListResponse,
    JobResponse,
    JobResult,
    MessageResponse,
    ReqBulkJobV2,
    ReqFramePackLoadV2,
    ReqVideoLoadV2,
    ResBulkJobV2,
    ResJobStatsV2,
    ResPurgeV2,
    StatusResponse,
    VideoEngine,
    VideoLoadResponse,
    VideoModel,
    VideoModelEnriched,
)
from enso_api.ws_models import WsEvent, WsEventPing

router = APIRouter(prefix="/sdapi/v2", tags=["v2"])


def job_to_response(job: dict) -> JobResponse:
    result = job.get("result")
    job_result = None
    if result:
        if isinstance(result, str):
            try:
                result = json.loads(result)
            except (json.JSONDecodeError, TypeError):
                result = None
        if isinstance(result, dict):
            job_result = JobResult.from_result_dict(result)
    return JobResponse(
        id=job["id"],
        type=job["type"],
        status=job["status"],
        progress=job.get("progress", 0),
        step=job.get("step", 0),
        steps=job.get("steps", 0),
        created_at=job["created_at"],
        started_at=job.get("started_at"),
        completed_at=job.get("completed_at"),
        error=job.get("error"),
        result=job_result,
    )


@router.post("/jobs", response_model=JobResponse, status_code=202, tags=["Jobs"])
async def submit_job(request: JobRequest):
    """Submit a job. Pydantic validates the body against JobRequest and rejects
    unknown fields with a 422 carrying field-level errors. The discriminator on
    `type` selects the matching parameter class. `priority` is honored across
    every job type and stripped before the params dict reaches the executor."""
    from enso_api.executors import EXECUTORS
    from enso_api.job_queue import job_queue

    payload = request.model_dump(exclude_unset=True)
    job_type = payload["type"]
    if job_type not in EXECUTORS:
        # Unreachable in normal flow: the discriminator already rejected unknown
        # types. Kept as a defensive guard for the case where JobRequest and
        # EXECUTORS drift during a refactor (a new model is added but its
        # executor entry is missing, or vice versa).
        log.warning(f"submit_job: type {job_type!r} accepted by JobRequest but absent from EXECUTORS")
        raise HTTPException(status_code=500, detail=f"Job type {job_type!r} has no registered executor")
    priority = payload.pop("priority", 0)
    job = job_queue.submit(job_type=job_type, params=payload, priority=priority)
    return job_to_response(job)


@router.get("/jobs", response_model=JobListResponse, tags=["Jobs"])
async def list_jobs(
    status: str | None = None,
    type: str | None = None,
    before: str | None = None,
    after: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    from enso_api.job_queue import job_queue

    items, total = job_queue.store.list(
        status=status,
        job_type=type,
        before=before,
        after=after,
        limit=limit,
        offset=offset,
    )
    return JobListResponse(items=[job_to_response(j) for j in items], total=total, offset=offset, limit=limit)


@router.delete("/jobs", response_model=ResPurgeV2, tags=["Jobs"])
async def purge_jobs():
    from enso_api.job_queue import job_queue

    deleted = await asyncio.to_thread(job_queue.store.purge)
    return {"deleted": deleted}


@router.get("/jobs/stats", response_model=ResJobStatsV2, tags=["Jobs"])
async def job_stats():
    from enso_api.job_queue import job_queue

    return await asyncio.to_thread(job_queue.store.stats)


@router.post("/jobs/bulk", response_model=ResBulkJobV2, tags=["Jobs"])
async def bulk_job_action(request: ReqBulkJobV2):
    if request.action not in ("cancel", "delete"):
        raise HTTPException(status_code=400, detail="action must be 'cancel' or 'delete'")
    if not any([request.status, request.type, request.ids, request.before, request.after]) and not request.confirm:
        raise HTTPException(status_code=400, detail="At least one filter (status, type, ids, before, after) is required, or set confirm=true")
    from enso_api.job_queue import job_queue

    if request.action == "cancel":
        affected = await asyncio.to_thread(
            job_queue.store.bulk_cancel,
            job_type=request.type,
            ids=request.ids,
            before=request.before,
            after=request.after,
        )
    else:
        affected = await asyncio.to_thread(
            job_queue.store.bulk_delete,
            status=request.status,
            job_type=request.type,
            ids=request.ids,
            before=request.before,
            after=request.after,
        )
    return ResBulkJobV2(action=request.action, affected=affected)


@router.get("/jobs/{job_id}", response_model=JobResponse, tags=["Jobs"])
async def get_job(job_id: str):
    from enso_api.job_queue import job_queue

    job = job_queue.store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    resp = job_to_response(job)
    # Optionally include inline base64 images
    try:
        from modules import shared

        if getattr(shared.opts, "api_v2_base64", False) and resp.result and resp.result.images:
            embed_base64(job, resp)
    except Exception:
        pass
    return resp


@router.delete("/jobs/{job_id}", response_model=StatusResponse, tags=["Jobs"])
async def delete_job(job_id: str):
    from enso_api.job_queue import job_queue

    job = job_queue.store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    success = job_queue.cancel(job_id)
    if not success:
        raise HTTPException(status_code=409, detail="Job cannot be cancelled or deleted")
    status = "cancelled" if job["status"] in ("pending", "running") else "deleted"
    return {"id": job_id, "status": status}


@router.get("/jobs/ws-events", response_model=WsEvent, tags=["WebSocket"])
async def get_ws_event_schema():
    """Documentation endpoint: returns the schema for events on the per-job WebSocket.

    The per-job WebSocket at ``/sdapi/v2/jobs/{job_id}/ws`` is not part of the
    OpenAPI spec (WebSockets aren't), but its event payloads are typed by
    :data:`enso_api.ws_models.WsEvent`. This HTTP route exists so the
    ``WsEvent`` discriminated union and every variant schema land in
    ``#/components/schemas`` for codegen consumers. The live response is a
    representative ping event for inspection.
    """
    return WsEventPing()


def embed_base64(job: dict, resp: JobResponse) -> None:
    import base64

    for img_ref in resp.result.images:
        file_path = get_ref_path(job, "images", img_ref.index)
        if file_path and os.path.isfile(file_path):
            with open(file_path, "rb") as f:
                img_ref.data = base64.b64encode(f.read()).decode("ascii")


def get_ref_path(job: dict, key: str, index: int) -> str | None:
    result = job.get("result")
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except (json.JSONDecodeError, TypeError):
            return None
    if not isinstance(result, dict):
        return None
    items = result.get(key, [])
    if index < 0 or index >= len(items):
        return None
    return items[index].get("path")


def confine_or_403(file_path: str) -> None:
    """Apply path confinement to `file_path` against the allowed outdir set.

    Centralised so any new ref-style file route picks up the same allow-list
    (cloud video thumbnail subroute, future audio routes, etc.) without
    duplicating the attr list. The list mirrors sdnext's modules.paths
    resolution targets plus the cloud-specific outdirs.
    """
    from modules import shared

    try:
        from modules.api.security import is_confined_to
    except ImportError:
        from enso_api.security_stubs import is_confined_to
    allowed_attrs = [
        "outdir_samples",
        "outdir_grids",
        "outdir_video",
        "outdir_txt2img_samples",
        "outdir_img2img_samples",
        "outdir_control_samples",
        "outdir_extras_samples",
        "outdir_cloud_image",
        "outdir_cloud_video",
    ]
    from enso_api.temp_store import get_staging_dir

    allowed = list({r for attr in allowed_attrs for r in [getattr(shared.opts, attr, None)] if r})
    staging = get_staging_dir()
    if staging:
        allowed.append(staging)
    if allowed and not is_confined_to(file_path, allowed):
        raise HTTPException(status_code=403, detail="Access denied")


MEDIA_TYPES = {
    "png": "image/png",
    "jpeg": "image/jpeg",
    "jpg": "image/jpeg",
    "webp": "image/webp",
    "jxl": "image/jxl",
    "mp4": "video/mp4",
    "webm": "video/webm",
    "gif": "image/gif",
}


def serve_file_path(file_path: str):
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")
    confine_or_403(file_path)
    ext = os.path.splitext(file_path)[1].lstrip(".").lower()
    return FileResponse(file_path, media_type=MEDIA_TYPES.get(ext, "application/octet-stream"))


def serve_job_file(job: dict, key: str, index: int):
    file_path = get_ref_path(job, key, index)
    if file_path is None:
        raise HTTPException(status_code=404, detail=f"{key} index {index} out of range")
    return serve_file_path(file_path)


def get_ref_field(job: dict, key: str, index: int, field: str) -> str | None:
    """Read an arbitrary field from a stored ref dict (e.g. `thumbnail_path`)."""
    result = job.get("result")
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except (json.JSONDecodeError, TypeError):
            return None
    if not isinstance(result, dict):
        return None
    items = result.get(key, [])
    if index < 0 or index >= len(items):
        return None
    value = items[index].get(field)
    return value if isinstance(value, str) else None


def get_completed_job(job_id: str):
    from enso_api.job_queue import job_queue

    job = job_queue.store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] != "completed":
        raise HTTPException(status_code=409, detail="Job not completed")
    return job


@router.get("/jobs/{job_id}/images/{index}", tags=["Jobs"])
async def get_job_image(job_id: str, index: int):
    return serve_job_file(get_completed_job(job_id), "images", index)


@router.get("/jobs/{job_id}/processed/{index}", tags=["Jobs"])
async def get_job_processed(job_id: str, index: int):
    return serve_job_file(get_completed_job(job_id), "processed", index)


@router.get("/jobs/{job_id}/videos/{index}", tags=["Jobs"])
async def get_job_video(job_id: str, index: int):
    return serve_job_file(get_completed_job(job_id), "videos", index)


@router.get("/jobs/{job_id}/videos/{index}/thumbnail", tags=["Jobs"])
async def get_job_video_thumbnail(job_id: str, index: int):
    job = get_completed_job(job_id)
    thumb_path = get_ref_field(job, "videos", index, "thumbnail_path")
    if thumb_path is None:
        raise HTTPException(status_code=404, detail="Thumbnail not available")
    return serve_file_path(thumb_path)


def parse_video_mode(name: str) -> str:
    lower = name.lower()
    if "flf2v" in lower:
        return "flf2v"
    if "vace" in lower:
        return "vace"
    if "animate" in lower:
        return "animate"
    if "i2v" in lower:
        return "i2v"
    return "t2v"


@router.get("/video/engines", response_model=list[VideoEngine], tags=["Video"])
async def list_video_engines():
    from modules.video_models import models_def, video_load

    from enso_api.util import is_model_cached

    current_loaded = video_load.loaded_model
    result = []
    for engine_name, model_list in models_def.models.items():
        if engine_name == "None":
            continue
        model_names = [m.name for m in model_list if m.name != "None"]
        details = []
        for m in model_list:
            if m.name == "None":
                continue
            cached = is_model_cached(m.repo) if m.repo else False
            loaded = m.name == current_loaded if current_loaded else False
            mode = parse_video_mode(m.name)
            details.append(VideoModelEnriched(name=m.name, repo=m.repo or "", url=m.url or "", cached=cached, loaded=loaded, mode=mode))
        result.append({"engine": engine_name, "models": model_names, "model_details": details})
    return result


@router.get("/video/engines/{engine}/models", response_model=list[VideoModel], tags=["Video"])
async def list_video_engine_models(engine: str):
    from modules.video_models import models_def

    if engine not in models_def.models:
        raise HTTPException(status_code=404, detail=f"Engine not found: {engine}")
    model_list = models_def.models[engine]
    return [{"name": m.name, "repo": m.repo or "", "url": m.url or ""} for m in model_list if m.name != "None"]


@router.post("/video/load", response_model=VideoLoadResponse, tags=["Video"])
async def load_video_model(request: ReqVideoLoadV2):
    def load():
        from modules.video_models import video_ui

        return list(video_ui.model_load(request.engine, request.model))

    messages = await asyncio.to_thread(load)
    return {"engine": request.engine, "model": request.model, "messages": messages}


@router.get("/framepack/variants", response_model=list[str], tags=["Video"])
async def list_framepack_variants():
    from modules.framepack import framepack_load

    return list(framepack_load.models.keys())


@router.post("/framepack/load", response_model=FramePackLoadResponse, tags=["Video"])
async def load_framepack_model(request: ReqFramePackLoadV2):
    def load():
        from modules.framepack import framepack_wrappers

        messages = []
        for item in framepack_wrappers.load_model(request.variant, request.attention):
            if isinstance(item, tuple) and len(item) > 2 and isinstance(item[2], str):
                messages.append(item[2])
        return messages

    messages = await asyncio.to_thread(load)
    return {"variant": request.variant, "messages": messages}


@router.post("/framepack/unload", response_model=MessageResponse, tags=["Video"])
async def unload_framepack_model():
    def _unload():
        from modules.framepack import framepack_wrappers

        list(framepack_wrappers.unload_model())

    await asyncio.to_thread(_unload)
    return {"messages": ["Model unloaded"]}
