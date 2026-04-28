"""Cloud provider registry.

Manages adapter instances for all configured providers. Call init_providers()
during API registration to load configs and create adapters.
"""

import os

from enso_api.cloud.config import ConfigStore, ProviderConfig
from enso_api.cloud.errors import CloudError
from enso_api.cloud.openai_compat import OpenAICompatAdapter
from enso_api.cloud.presets import PRESETS
from enso_api.cloud.transport import HttpTransport

_config_store: ConfigStore | None = None
_adapters: dict[str, OpenAICompatAdapter] = {}


def init_providers(enso_root: str) -> None:
    global _config_store  # pylint: disable=global-statement
    config_path = os.path.join(enso_root, "cloud-providers.local.json")
    _config_store = ConfigStore(config_path)
    _rebuild_adapters()


def _rebuild_adapters() -> None:
    for adapter in _adapters.values():
        try:
            import asyncio
            loop = asyncio.new_event_loop()
            loop.run_until_complete(adapter.http.close())
            loop.close()
        except Exception:
            pass
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
    return cfg


def update_provider(provider_id: str, **kwargs) -> ProviderConfig | None:
    store = get_config_store()
    cfg = store.update(provider_id, **kwargs)
    if cfg is None:
        return None
    if provider_id in _adapters:
        try:
            import asyncio
            loop = asyncio.new_event_loop()
            loop.run_until_complete(_adapters[provider_id].http.close())
            loop.close()
        except Exception:
            pass
        del _adapters[provider_id]
    if cfg.enabled:
        _create_adapter(cfg)
    return cfg


def remove_provider(provider_id: str) -> bool:
    store = get_config_store()
    if provider_id in _adapters:
        try:
            import asyncio
            loop = asyncio.new_event_loop()
            loop.run_until_complete(_adapters[provider_id].http.close())
            loop.close()
        except Exception:
            pass
        del _adapters[provider_id]
    return store.remove(provider_id)
