"""Cloud provider registry.

Manages adapter instances for all configured providers. Call init_providers()
during API registration to load configs and create adapters.
"""

import asyncio
import os

from modules.logger import log

from enso_api.cloud.config import ConfigStore, ProviderConfig
from enso_api.cloud.errors import CloudError
from enso_api.cloud.openai_compat import OpenAICompatAdapter
from enso_api.cloud.presets import PRESETS
from enso_api.cloud.transport import HttpTransport

_config_store: ConfigStore | None = None
_adapters: dict[str, OpenAICompatAdapter] = {}
_main_loop: asyncio.AbstractEventLoop | None = None


def set_main_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Record FastAPI's event loop so cloud worker threads can dispatch coroutines
    back to it via run_coroutine_threadsafe. Called from a cloud route dependency
    on first request; idempotent thereafter.

    Why this matters: httpx.AsyncClient binds its internal asyncio.Event/Lock
    primitives to whichever loop first uses it. Provider routes run on FastAPI's
    loop and bind there; if cloud jobs then run on per-worker-thread loops, the
    cross-loop reuse fails with "Event is bound to a different event loop" and
    burns a retry cycle (~30s) before httpx recovers."""
    global _main_loop  # pylint: disable=global-statement
    if _main_loop is None:
        _main_loop = loop
        log.debug("Cloud: captured main event loop for cross-thread dispatch")


def get_main_loop() -> asyncio.AbstractEventLoop | None:
    return _main_loop


def init_providers(enso_root: str) -> None:
    global _config_store  # pylint: disable=global-statement
    config_path = os.path.join(enso_root, "cloud-providers.local.json")
    _config_store = ConfigStore(config_path)
    _rebuild_adapters()
    log.info(f"Cloud: initialized providers={len(_adapters)} config={config_path}")


def _close_adapter_http(adapter: OpenAICompatAdapter, context: str) -> None:
    # httpx.AsyncClient.close() must run on the loop the client's primitives bind
    # to (FastAPI's main loop). If captured, dispatch there; otherwise fall back
    # to a fresh loop (only happens at startup before any cloud route hits).
    try:
        main_loop = _main_loop
        if main_loop is not None and main_loop.is_running():
            future = asyncio.run_coroutine_threadsafe(adapter.http.close(), main_loop)
            future.result(timeout=5)
        else:
            loop = asyncio.new_event_loop()
            loop.run_until_complete(adapter.http.close())
            loop.close()
    except Exception as e:
        log.warning(f"Cloud: adapter close error provider={adapter.config.id} context={context}: {e}")


def _rebuild_adapters() -> None:
    for adapter in _adapters.values():
        _close_adapter_http(adapter, context="rebuild")
    _adapters.clear()

    if _config_store is None:
        return
    for cfg in _config_store.list():
        if cfg.enabled:
            _create_adapter(cfg)


def _create_adapter(cfg: ProviderConfig) -> OpenAICompatAdapter:
    preset = PRESETS.get(cfg.preset, PRESETS["custom"])
    transport = HttpTransport(cfg, preset, _config_store)
    adapter = OpenAICompatAdapter(cfg, transport, preset)
    _adapters[cfg.id] = adapter
    log.debug(f"Cloud: adapter created provider={cfg.id} name={cfg.name!r} preset={cfg.preset} base_url={cfg.base_url}")
    return adapter


def get_adapter(provider_id: str) -> OpenAICompatAdapter:
    adapter = _adapters.get(provider_id)
    if adapter is None:
        raise ValueError(f"Provider not configured or disabled: {provider_id}")
    return adapter


def get_config_store() -> ConfigStore:
    if _config_store is None:
        raise RuntimeError("Cloud providers not initialized")
    return _config_store


def list_providers() -> list[dict]:
    if _config_store is None:
        return []
    result = []
    for cfg in _config_store.list():
        entry = {
            "id": cfg.id,
            "name": cfg.name,
            "preset": cfg.preset,
            "base_url": cfg.base_url,
            "has_key": bool(cfg.key or _config_store.resolve_key(cfg)),
            "enabled": cfg.enabled,
            "status": "ok" if cfg.id in _adapters else "unchecked",
            "model_count": 0,
        }
        result.append(entry)
    return result


async def refresh_models(provider_id: str) -> list[dict]:
    adapter = get_adapter(provider_id)
    adapter.http.invalidate_cache()
    return await adapter.list_models()


def add_provider(name: str, preset: str, base_url: str, key: str = "") -> ProviderConfig:
    store = get_config_store()
    cfg = store.add(name, preset, base_url, key)
    _create_adapter(cfg)
    log.info(f"Cloud: provider added id={cfg.id} name={cfg.name!r} preset={preset} has_key={bool(key)}")
    return cfg


def update_provider(provider_id: str, **kwargs) -> ProviderConfig | None:
    store = get_config_store()
    cfg = store.update(provider_id, **kwargs)
    if cfg is None:
        log.warning(f"Cloud: update_provider not found id={provider_id}")
        return None
    if provider_id in _adapters:
        _close_adapter_http(_adapters[provider_id], context="update")
        del _adapters[provider_id]
    if cfg.enabled:
        _create_adapter(cfg)
    log.info(f"Cloud: provider updated id={cfg.id} fields={list(kwargs)} enabled={cfg.enabled}")
    return cfg


def remove_provider(provider_id: str) -> bool:
    store = get_config_store()
    if provider_id in _adapters:
        _close_adapter_http(_adapters[provider_id], context="remove")
        del _adapters[provider_id]
    removed = store.remove(provider_id)
    if removed:
        log.info(f"Cloud: provider removed id={provider_id}")
    else:
        log.warning(f"Cloud: remove_provider not found id={provider_id}")
    return removed
