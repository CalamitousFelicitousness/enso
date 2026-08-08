"""Enso - React frontend with infinite canvas and v2 API extension for SD.Next.

This extension entry point:
1. Adds the extension root to sys.path so ``enso_api`` is importable
2. Registers all v2 API routes via ``enso_api.register_api``
3. Mounts the built frontend at ``/enso/``
"""

import json
import os
import sys

from modules import script_callbacks

ext_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def register_cloud_options():
    """Register Enso-managed cloud settings with the options registry.

    The frontend stores cloud defaults and provider records through the
    generic options surface; unregistered keys are flagged unknown at boot
    and unused on every config save. Registered hidden: Enso's own UI
    manages them, so they have no place on the settings page. Provider API
    keys are named cloud_<id>_key and route to secrets.json by suffix; ids
    come from the stored provider list, so a provider added mid-session
    registers its key on the next start.
    """
    from modules.shared import OptionInfo, opts

    section = ("enso", "Enso")
    hidden = {"visible": False}
    settings = {
        "cloud_providers": ("[]", "Cloud providers"),
        "cloud_default_provider": ("", "Default cloud provider"),
        "cloud_default_text_provider": ("", "Default cloud text provider"),
        "cloud_default_vision_provider": ("", "Default cloud vision provider"),
        "cloud_default_image_provider": ("", "Default cloud image provider"),
        "cloud_default_video_provider": ("", "Default cloud video provider"),
        "cloud_default_audio_provider": ("", "Default cloud audio provider"),
    }
    for name, (default, label) in settings.items():
        opts.add_option(name, OptionInfo(default, label, component_args=hidden, section=section))
    try:
        providers = json.loads(opts.data.get("cloud_providers") or "[]")
    except (TypeError, ValueError):
        providers = []
    for provider in providers:
        pid = provider.get("id") if isinstance(provider, dict) else None
        if pid:
            opts.add_option(f"cloud_{pid}_key", OptionInfo("", f"Cloud provider key: {pid}", component_args=hidden, section=section))


register_cloud_options()


def on_app_started(blocks, app):  # pylint: disable=unused-argument
    # SD.Next resets sys.path after loading each extension script,
    # so the path must be added here rather than at module level.
    if ext_root not in sys.path:
        sys.path.insert(0, ext_root)

    from fastapi import Depends
    from modules import shared

    from enso_api import register_api

    # Write SD.Next port so the Vite dev server can auto-detect it
    port = getattr(shared.cmd_opts, "port", 7860) or 7860
    for port_path in [os.path.join(ext_root, ".sdnext.port"), os.path.expanduser("~/.sdnext.port")]:
        try:
            with open(port_path, "w", encoding="utf-8") as f:
                f.write(str(port))
        except Exception:
            pass

    # Mirror SD.Next's v1 auth wiring on v2 routers. shared.api.add_api_route
    # auto-injects this dependency for routes added through it (gallery,
    # system_ops, models_ops, etc.), but routers mounted via include_router
    # (jobs, upload, endpoints, server, caption, prompt_enhance, xyz_grid)
    # need it threaded in explicitly or they bypass --auth entirely.
    deps = []
    api_inst = getattr(shared, "api", None)
    if api_inst is not None and getattr(api_inst, "credentials", None):
        deps.append(Depends(api_inst.auth))

    register_api(app, dependencies=deps)

    # Mount built frontend
    dist_dir = os.path.join(ext_root, "dist")
    if os.path.isdir(dist_dir):
        from starlette.staticfiles import StaticFiles

        app.mount("/enso", StaticFiles(directory=dist_dir, html=True), name="enso")
        from installer import log

        log.info(f"Enso: path={dist_dir}")


script_callbacks.on_app_started(on_app_started)
