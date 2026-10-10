"""Enso API - v2 async job-queue API for SD.Next.

Call ``register_api(app)`` from the extension entry point to mount all
v2 routes, WebSocket endpoints and the media store.
"""

import os
import tempfile


def register_api(app, dependencies=None):
    from modules import shared
    from modules.logger import log

    from enso_api.job_queue import job_queue
    from enso_api.job_types import validate_registries
    from enso_api.media import boot as media_boot
    from enso_api.media.routes import router as media_store_router
    from enso_api.media.routes import serve_router as media_serve_router
    from enso_api.routes import media_router, router
    from enso_api.session import public_router as session_public_router
    from enso_api.session import router as session_router
    from enso_api.sqlite import NewerDatabase
    from enso_api.upload import upload_media_router, upload_router
    from enso_api.ws import ws_job_endpoint

    deps = dependencies or []

    from modules import paths

    # Queue and output state must outlive this extension checkout: a redeploy
    # or git clean of the extension root takes anything stored there with it,
    # so the db lives with sdnext's own state files under <data_path>/data.
    enso_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    enso_data = os.path.join(paths.data_path, "data", "enso")
    # Before the queue, which names what its pending jobs use
    media_boot.init(paths.data_path)
    try:
        job_queue.init(enso_data, legacy_path=enso_root)
    except NewerDatabase as e:
        log.error(f"Enso: API off: {e}; run a newer Enso or move the file aside")
        return

    # Cloud provider registry, transport, and adapters now live in
    # modules.cloud (sdnext core). Provider CRUD goes through
    # /sdapi/v1/cloud/* on the sdnext side; Text features use V1
    # directly. The V2 cloud_* job-type executors are stubs until the
    # sdnext core ships modules.cloud.image /.video /.audio.

    # Fail fast if JobRequest union, EXECUTORS dict, and JOB_TYPE_META diverge
    # so a missing executor or meta entry aborts boot rather than surfacing
    # as a 500 on the first client submit.
    validate_registries()

    # Processor defaults as served to clients; the Gradio control UI edits sdnext's live table
    from enso_api.preprocess import snapshot_defaults

    snapshot_defaults()

    # control_run takes generate fields by name, so a keyword renamed in sdnext
    # would drop its field from every job without an error
    from enso_api.executors import missing_sdnext_names, unforwarded_generate_fields

    unforwarded = unforwarded_generate_fields()
    if unforwarded:
        log.warning(f"Enso: control_run does not take these generate fields, so they have no effect: {', '.join(unforwarded)}")

    # executors import these sdnext names lazily, so a rename would otherwise
    # surface as a 500 on the first job that needs it
    missing = missing_sdnext_names()
    if missing:
        log.warning(f"Enso: sdnext no longer provides these names, so the jobs using them will fail: {', '.join(missing)}")

    from enso_api.temp_store import init as init_temp_store

    temp_staging_dir = os.path.join(shared.opts.temp_dir or tempfile.gettempdir(), "enso_staging")
    init_temp_store(temp_staging_dir, ttl_seconds=3600)

    app.include_router(router, dependencies=deps)
    app.include_router(upload_router, dependencies=deps)
    app.include_router(session_router, dependencies=deps)
    app.include_router(session_public_router)
    app.include_router(media_store_router, dependencies=deps)
    # Media routers carry their own auth: the session cookie, else what sdnext's auth admits
    app.include_router(media_router)
    app.include_router(upload_media_router)
    app.include_router(media_serve_router)
    app.add_api_websocket_route("/sdapi/v2/jobs/{job_id}/ws", ws_job_endpoint)

    from enso_api.endpoints import router as endpoints_router

    app.include_router(endpoints_router, dependencies=deps)

    from enso_api.server import router as server_router

    app.include_router(server_router, dependencies=deps)

    from enso_api.caption import router as caption_router

    app.include_router(caption_router, dependencies=deps)

    from enso_api.prompt_enhance import router as prompt_enhance_router

    app.include_router(prompt_enhance_router, dependencies=deps)

    from enso_api.xyz_grid import router as xyz_grid_router

    app.include_router(xyz_grid_router, dependencies=deps)

    from enso_api.postprocess import router as postprocess_router

    app.include_router(postprocess_router, dependencies=deps)

    # Global WebSocket (progress push, interrupt/skip)
    from enso_api.global_ws import register_ws

    register_ws(app)

    # Gallery / browser endpoints
    from enso_api.gallery import register_api as register_gallery

    register_gallery(app)

    # System operations (restart, update, benchmark, storage)
    from enso_api.system_ops import register_api as register_system_ops

    register_system_ops()

    # Model operations (analyze, save, merge, replace, loader, lora extract)
    from enso_api.models_ops import register_api as register_models_ops

    register_models_ops()

    # Loaded models inventory
    from enso_api.loaded_models import register_api as register_loaded_models

    register_loaded_models()

    # Misc v2 routes (HuggingFace, extra-networks detail)
    from enso_api.misc_routes import register_misc_routes

    register_misc_routes(app, shared.api.add_api_route)

    # Log suppression - register noisy polling endpoints with the rate-limited logger
    try:
        from modules.api.validate import log_cost

        log_cost.update(
            {
                "/sdapi/v2/jobs": -1,
                "/sdapi/v2/server-info": -1,
                "/sdapi/v2/memory": -1,
                "/sdapi/v2/gpu": -1,
                "/sdapi/v2/log": -1,
                "/sdapi/v2/system-info": -1,
                "/sdapi/v2/options": -1,
                "/sdapi/v2/options-info": -1,
                "/sdapi/v2/browser/thumb": -1,
                "/sdapi/v2/browser/folder-info": -1,
                "/sdapi/v2/browser/subdirs": -1,
                "/sdapi/v2/loaded-models": -1,
                "/sdapi/v2/jobs/stats": -1,
                "/sdapi/v2/jobs/bulk": -1,
                "/sdapi/v2/session": -1,
                "/sdapi/v2/blobs/claim": -1,
                "/sdapi/v2/media": -1,
            }
        )
    except ImportError:
        pass

    # Rate limit costs
    from modules.api.validate import request_cost

    request_cost.update(
        {
            # Cost 0 - polling / status / file serving (exempt)
            "/sdapi/v2/server-info": 0,
            "/sdapi/v2/memory": 0,
            "/sdapi/v2/gpu": 0,
            "/sdapi/v2/log": 0,
            "/sdapi/v2/system-info": 0,
            "/sdapi/v2/options": 0,
            "/sdapi/v2/options-info": 0,
            "/sdapi/v2/secrets-status": 0,
            "/sdapi/v2/browser/thumb": 0,
            "/sdapi/v2/browser/file": 0,
            "/sdapi/v2/browser/files": 0,
            "/sdapi/v2/browser/folders": 0,
            "/sdapi/v2/browser/folder-info": 0,
            "/sdapi/v2/browser/subdirs": 0,
            "/sdapi/v2/loaded-models": 0,
            "/sdapi/v2/jobs/stats": 0,
            "/sdapi/v2/jobs/bulk": 5,
            "/sdapi/v2/ws-ticket": 0,
            "/sdapi/v2/session": 0,
            "/sdapi/v2/extra-networks/detail": 0,
            "/sdapi/v2/extra-networks/details": 0,
            # Uploads of one action come in bursts, and each blob URL is its own window
            "/sdapi/v2/blobs": 0,
            "/sdapi/v2/blobs/claim": 0,
            "/sdapi/v2/blobs/adopt": 0,
            "/sdapi/v2/media": 0,
            "/sdapi/v2/media/settings": 0,
            "/sdapi/v2/uploads/{ref_id}": 0,  # dormant until route-template keys
            "/sdapi/v2/jobs/{job_id}": 0,  # dormant until route-template keys
            "/sdapi/v2/jobs/{job_id}/images/{index}": 0,  # dormant until route-template keys
            "/sdapi/v2/jobs/{job_id}/processed/{index}": 0,  # dormant until route-template keys
            "/sdapi/v2/outputs/{output_id}": 0,  # dormant until route-template keys
            # Cost 5 - GPU / compute / IO intensive
            "/sdapi/v2/jobs": 5,
            "/sdapi/v2/video/load": 5,
            "/sdapi/v2/framepack/load": 5,
            "/sdapi/v2/checkpoint": 5,
            "/sdapi/v2/checkpoint/reload": 5,
            "/sdapi/v2/model/loader/load": 5,
            "/sdapi/v2/model/merge": 5,
            "/sdapi/v2/model/lora/extract": 5,
            "/sdapi/v2/model/save": 5,
            "/sdapi/v2/model/replace": 5,
            "/sdapi/v2/caption/vlm": 5,
            "/sdapi/v2/caption/tagger": 5,
            "/sdapi/v2/caption/openclip": 5,
            "/sdapi/v2/prompt-enhance": 5,
            "/sdapi/v2/preprocess": 5,
            "/sdapi/v2/benchmark/run": 5,
            "/sdapi/v2/xyz-grid/preview": 5,
        }
    )

    log.info("Enso API: registered")
