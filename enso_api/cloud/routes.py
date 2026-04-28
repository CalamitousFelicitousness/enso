"""Cloud provider management API routes."""

import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import enso_api.cloud as cloud_registry


router = APIRouter(prefix="/sdapi/v2/cloud", tags=["Cloud"])


class AddProviderRequest(BaseModel):
    name: str = Field(title="Display name")
    preset: str = Field(title="Preset type", description="openrouter, openai, nanogpt, aihubmix, ollama, or custom")
    base_url: str = Field(title="Base URL")
    key: str = Field(default="", title="API key")


class UpdateProviderRequest(BaseModel):
    name: Optional[str] = None
    base_url: Optional[str] = None
    key: Optional[str] = None
    enabled: Optional[bool] = None


@router.get("/providers")
async def list_providers():
    return cloud_registry.list_providers()


@router.post("/providers", status_code=201)
async def add_provider(req: AddProviderRequest):
    from enso_api.cloud.presets import PRESETS
    if req.preset not in PRESETS:
        raise HTTPException(status_code=400, detail=f"Invalid preset: {req.preset}. Must be one of: {', '.join(sorted(PRESETS))}")
    if not req.base_url and req.preset == "custom":
        raise HTTPException(status_code=400, detail="base_url is required for custom providers")

    base_url = req.base_url or PRESETS[req.preset].get("base_url", "")
    cfg = cloud_registry.add_provider(req.name, req.preset, base_url, req.key)

    valid = False
    error = None
    if cfg.key or req.preset == "ollama":
        try:
            adapter = cloud_registry.get_adapter(cfg.id)
            valid = await adapter.validate_key()
            if not valid:
                error = "Key validation failed"
        except Exception as e:
            error = str(e)

    return {
        "id": cfg.id,
        "name": cfg.name,
        "preset": cfg.preset,
        "base_url": cfg.base_url,
        "has_key": bool(cfg.key),
        "enabled": cfg.enabled,
        "status": "ok" if valid else "error",
        "error": error,
    }


@router.put("/providers/{provider_id}")
async def update_provider(provider_id: str, req: UpdateProviderRequest):
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    cfg = cloud_registry.update_provider(provider_id, **updates)
    if cfg is None:
        raise HTTPException(status_code=404, detail=f"Provider not found: {provider_id}")

    return {
        "id": cfg.id,
        "name": cfg.name,
        "preset": cfg.preset,
        "base_url": cfg.base_url,
        "has_key": bool(cfg.key),
        "enabled": cfg.enabled,
    }


@router.delete("/providers/{provider_id}")
async def remove_provider(provider_id: str):
    removed = cloud_registry.remove_provider(provider_id)
    if not removed:
        raise HTTPException(status_code=404, detail=f"Provider not found: {provider_id}")
    return {"deleted": True}


@router.post("/providers/{provider_id}/refresh")
async def refresh_provider_models(provider_id: str):
    try:
        models = await cloud_registry.refresh_models(provider_id)
        return {"model_count": len(models)}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from None
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from None


@router.post("/providers/{provider_id}/validate")
async def validate_provider(provider_id: str):
    try:
        adapter = cloud_registry.get_adapter(provider_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from None

    try:
        valid = await adapter.validate_key()
        return {"valid": valid, "error": None if valid else "Validation failed"}
    except Exception as e:
        return {"valid": False, "error": str(e)}


@router.get("/providers/{provider_id}/models")
async def get_provider_models(provider_id: str):
    try:
        adapter = cloud_registry.get_adapter(provider_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from None

    try:
        models = await adapter.list_models()
        return {"models": models, "total": len(models)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch models: {e}") from None
