"""Strict request bodies for cloud-provider job types.

These are members of the top-level ``JobRequest`` discriminated union in
``enso_api/job_models.py`` and flow through the same
``POST /sdapi/v2/jobs`` route as local executor types. The provider
adapters in ``enso_api.cloud.adapters`` consume the raw dict produced
by ``model_dump(exclude_unset=True)``, so absent optional fields stay
absent rather than being filled with Pydantic defaults.

Frontend reference: ``src/api/types/cloud.ts``.
"""

from typing import Any, Literal, Optional

from pydantic import Field

from enso_api.models import StrictBaseModel


class CloudJobBase(StrictBaseModel):
    """Common cloud-job header: provider id, model id, priority."""

    provider: str = Field(description="Provider id as registered in cloud config")
    model: str = Field(description="Provider-namespaced model id")
    priority: int = Field(default=0, description="Higher runs first")


class CloudImageParams(CloudJobBase):
    """Cloud image generation (txt2img or img2img depending on `image`)."""

    type: Literal["cloud_image"] = "cloud_image"
    prompt: str
    negative_prompt: Optional[str] = None
    size: Optional[str] = Field(default=None, description="WxH string, e.g. '1024x1024'")
    n: Optional[int] = Field(default=None, description="Batch count")
    seed: Optional[int] = None
    guidance: Optional[float] = None
    steps: Optional[int] = None
    quality: Optional[str] = None
    style: Optional[str] = None
    image: Optional[str] = Field(default=None, description="img2img source (upload ref or base64)")
    mask: Optional[str] = Field(default=None, description="Inpaint mask (upload ref or base64)")
    strength: Optional[float] = None
    width: Optional[int] = Field(default=None, description="Width hint for result metadata")
    height: Optional[int] = Field(default=None, description="Height hint for result metadata")
    extra_params: dict[str, Any] = Field(default_factory=dict, description="Provider-specific passthrough fields")


class CloudChatMessage(StrictBaseModel):
    """One chat turn."""

    role: str
    content: str


class CloudChatParams(CloudJobBase):
    """Cloud LLM chat completion."""

    type: Literal["cloud_chat"] = "cloud_chat"
    messages: list[CloudChatMessage] = Field(default_factory=list)
    prompt: Optional[str] = Field(default=None, description="Convenience: single user message; ignored if messages set")
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    max_tokens: Optional[int] = None
    stream: bool = False
    seed: Optional[int] = None
    extra_params: dict[str, Any] = Field(default_factory=dict)


class CloudTtsParams(CloudJobBase):
    """Cloud text-to-speech."""

    type: Literal["cloud_tts"] = "cloud_tts"
    input: str = Field(description="Text to synthesize")
    voice: Optional[str] = None
    speed: Optional[float] = None
    response_format: Optional[Literal["mp3", "opus", "aac", "flac", "wav", "pcm"]] = None


class CloudSttParams(CloudJobBase):
    """Cloud speech-to-text."""

    type: Literal["cloud_stt"] = "cloud_stt"
    audio: str = Field(description="Audio (upload ref or base64)")
    language: Optional[str] = None
    response_format: Optional[Literal["json", "text", "srt", "vtt"]] = None


class CloudVideoParams(CloudJobBase):
    """Cloud video generation."""

    type: Literal["cloud_video"] = "cloud_video"
    prompt: str
    aspect_ratio: Optional[str] = None
    duration: Optional[float] = None
    size: Optional[str] = None
    image: Optional[str] = Field(default=None, description="Optional first-frame image (upload ref or base64)")
    extra_params: dict[str, Any] = Field(default_factory=dict)
