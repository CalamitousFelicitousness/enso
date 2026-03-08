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

    data_path = os.path.dirname(shared.cmd_opts.config)
    if not data_path:
        data_path = '.'
    job_queue.init(data_path)

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

    from modules.logger import log
    log.info('Enso API: registered')
