"""Provider configuration storage.

Loads and saves provider configs from cloud-providers.local.json.
Environment variables override stored keys.
"""

import json
import os
import re
from dataclasses import dataclass, field


ENV_KEY_MAP = {
    "openrouter": "OPENROUTER_API_KEY",
    "openai": "OPENAI_API_KEY",
    "nanogpt": "NANOGPT_API_KEY",
    "aihubmix": "AIHUBMIX_API_KEY",
}


@dataclass
class ProviderConfig:
    id: str
    name: str
    preset: str
    base_url: str
    key: str = ""
    enabled: bool = True


@dataclass
class ProvidersFile:
    providers: list[ProviderConfig] = field(default_factory=list)


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "provider"


def _make_unique_id(slug: str, existing: list[str]) -> str:
    if slug not in existing:
        return slug
    for i in range(2, 100):
        candidate = f"{slug}-{i}"
        if candidate not in existing:
            return candidate
    return f"{slug}-{len(existing)}"


class ConfigStore:
    def __init__(self, config_path: str):
        self._path = config_path
        self._providers: list[ProviderConfig] = []
        self._load()

    def _load(self) -> None:
        if not os.path.exists(self._path):
            self._providers = []
            return
        try:
            with open(self._path, encoding="utf-8") as f:
                data = json.load(f)
            self._providers = [
                ProviderConfig(**p) for p in data.get("providers", [])
            ]
        except (json.JSONDecodeError, TypeError, KeyError):
            self._providers = []

    def _save(self) -> None:
        os.makedirs(os.path.dirname(self._path), exist_ok=True)
        data = {"providers": [vars(p) for p in self._providers]}
        fd = os.open(self._path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception:
            os.close(fd)
            raise

    def list(self) -> list[ProviderConfig]:
        return list(self._providers)

    def get(self, provider_id: str) -> ProviderConfig | None:
        return next((p for p in self._providers if p.id == provider_id), None)

    def add(self, name: str, preset: str, base_url: str, key: str = "") -> ProviderConfig:
        existing_ids = [p.id for p in self._providers]
        slug = _slugify(name)
        provider_id = _make_unique_id(slug, existing_ids)
        config = ProviderConfig(
            id=provider_id,
            name=name,
            preset=preset,
            base_url=base_url.rstrip("/"),
            key=key,
            enabled=True,
        )
        self._providers.append(config)
        self._save()
        return config

    def update(self, provider_id: str, **kwargs) -> ProviderConfig | None:
        config = self.get(provider_id)
        if config is None:
            return None
        for k, v in kwargs.items():
            if hasattr(config, k) and k != "id":
                setattr(config, k, v)
        if "base_url" in kwargs:
            config.base_url = config.base_url.rstrip("/")
        self._save()
        return config

    def remove(self, provider_id: str) -> bool:
        before = len(self._providers)
        self._providers = [p for p in self._providers if p.id != provider_id]
        if len(self._providers) < before:
            self._save()
            return True
        return False

    def resolve_key(self, config: ProviderConfig) -> str:
        env_var = ENV_KEY_MAP.get(config.preset)
        if env_var:
            env_val = os.environ.get(env_var)
            if env_val:
                return env_val
        return config.key
