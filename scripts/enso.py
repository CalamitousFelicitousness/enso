"""Enso - React frontend with infinite canvas and v2 API extension for SD.Next.

This extension entry point:
1. Adds the extension root to sys.path so ``enso_api`` is importable
2. Registers all v2 API routes via ``enso_api.register_api``
3. Mounts the built frontend at ``/enso/``
"""

import os
import sys

from modules import script_callbacks

ext_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def on_app_started(blocks, app):  # pylint: disable=unused-argument
    # SD.Next resets sys.path after loading each extension script,
    # so the path must be added here rather than at module level.
    if ext_root not in sys.path:
        sys.path.insert(0, ext_root)

    from modules import shared
    from enso_api import register_api

    # Write SD.Next port so the Vite dev server can auto-detect it
    port = getattr(shared.cmd_opts, 'port', 7860) or 7860
    for port_path in [os.path.join(ext_root, '.sdnext.port'), os.path.expanduser('~/.sdnext.port')]:
        try:
            with open(port_path, 'w', encoding='utf-8') as f:
                f.write(str(port))
        except Exception:
            pass

    # Register all v2 API routes
    register_api(app)

    # Mount built frontend
    dist_dir = os.path.join(ext_root, "dist")
    if os.path.isdir(dist_dir):
        from starlette.staticfiles import StaticFiles
        app.mount("/enso", StaticFiles(directory=dist_dir, html=True), name="enso")
        from installer import log
        log.info(f'Enso: path={dist_dir}')


script_callbacks.on_app_started(on_app_started)
