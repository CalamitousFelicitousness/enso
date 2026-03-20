"""Enso API - v2 async job-queue API for SD.Next.

Call ``register_api(app)`` from the extension entry point to mount all
v2 routes, WebSocket endpoints, and the file-upload staging area.
"""

import os
import tempfile


def register_api(app, dependencies=None):
    from modules import shared
    from enso_api.job_queue import job_queue
    from enso_api.routes import router
    from enso_api.upload import upload_router, init_upload_store
    from enso_api.ws import ws_job_endpoint

    deps = dependencies or []

    enso_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    job_queue.init(enso_root)

    staging_dir = os.path.join(shared.opts.temp_dir or tempfile.gettempdir(), 'uploads')
    init_upload_store(staging_dir, ttl=1800)

    app.include_router(router, dependencies=deps)
    app.include_router(upload_router, dependencies=deps)
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

    # Misc v2 routes (HuggingFace, extra-networks detail, ws-ticket)
    from enso_api.misc_routes import register_misc_routes
    register_misc_routes(app, shared.api.add_api_route)

    # Log suppression — register noisy polling endpoints with the rate-limited logger
    try:
        from modules.api.validate import log_cost
        log_cost.update({
            '/sdapi/v2/jobs': -1,
            '/sdapi/v2/server-info': -1,
            '/sdapi/v2/memory': -1,
            '/sdapi/v2/gpu': -1,
            '/sdapi/v2/log': -1,
            '/sdapi/v2/system-info': -1,
            '/sdapi/v2/options': -1,
            '/sdapi/v2/options-info': -1,
            '/sdapi/v2/browser/thumb': -1,
            '/sdapi/v2/loaded-models': -1,
        })
    except ImportError:
        pass

    # Rate limit costs
    from modules.api.validate import request_cost
    request_cost.update({
        # Cost 0 — polling / status / file serving (exempt)
        '/sdapi/v2/server-info': 0,
        '/sdapi/v2/memory': 0,
        '/sdapi/v2/gpu': 0,
        '/sdapi/v2/log': 0,
        '/sdapi/v2/system-info': 0,
        '/sdapi/v2/options': 0,
        '/sdapi/v2/options-info': 0,
        '/sdapi/v2/secrets-status': 0,
        '/sdapi/v2/browser/thumb': 0,
        '/sdapi/v2/browser/files': 0,
        '/sdapi/v2/browser/folders': 0,
        '/sdapi/v2/browser/folder-info': 0,
        '/sdapi/v2/browser/subdirs': 0,
        '/sdapi/v2/loaded-models': 0,
        '/sdapi/v2/ws-ticket': 0,
        '/sdapi/v2/extra-networks/detail': 0,
        '/sdapi/v2/extra-networks/details': 0,
        '/sdapi/v2/uploads/{ref_id}': 0,                   # dormant until route-template keys
        '/sdapi/v2/jobs/{job_id}': 0,                       # dormant until route-template keys
        '/sdapi/v2/jobs/{job_id}/images/{index}': 0,        # dormant until route-template keys
        '/sdapi/v2/jobs/{job_id}/processed/{index}': 0,     # dormant until route-template keys
        # Cost 5 — GPU / compute / IO intensive
        '/sdapi/v2/jobs': 5,
        '/sdapi/v2/video/load': 5,
        '/sdapi/v2/framepack/load': 5,
        '/sdapi/v2/checkpoint': 5,
        '/sdapi/v2/checkpoint/reload': 5,
        '/sdapi/v2/model/loader/load': 5,
        '/sdapi/v2/model/merge': 5,
        '/sdapi/v2/model/lora/extract': 5,
        '/sdapi/v2/model/save': 5,
        '/sdapi/v2/model/replace': 5,
        '/sdapi/v2/caption/vlm': 5,
        '/sdapi/v2/caption/tagger': 5,
        '/sdapi/v2/caption/openclip': 5,
        '/sdapi/v2/prompt-enhance': 5,
        '/sdapi/v2/preprocess': 5,
        '/sdapi/v2/benchmark/run': 5,
        '/sdapi/v2/xyz-grid/preview': 5,
    })

    from modules.logger import log
    log.info('Enso API: registered')
