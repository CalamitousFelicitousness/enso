"""Provider adapter protocol and result types.

The Protocol defines the contract any adapter must satisfy. Result types
are shared across all adapters regardless of implementation.
"""
# pylint: disable=unnecessary-ellipsis

from dataclasses import dataclass, field
from typing import Callable, Protocol

@dataclass
class CloudUsage:
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    cost: float | None = None


@dataclass
class ImageResult:
    images: list[bytes] = field(default_factory=list)
    revised_prompt: str | None = None
    format: str = "png"
    usage: CloudUsage | None = None


@dataclass
class ChatResult:
    content: str = ""
    tool_calls: list[dict] | None = None
    finish_reason: str = "stop"
    usage: CloudUsage | None = None


@dataclass
class AudioResult:
    data: bytes = b""
    format: str = "mp3"
    duration: float | None = None


@dataclass
class TranscribeResult:
    text: str = ""
    language: str | None = None
    segments: list[dict] | None = None
    duration: float | None = None


@dataclass
class VideoResult:
    data: bytes = b""
    format: str = "mp4"
    duration: float | None = None
    thumbnail: bytes | None = None


ProgressCallback = Callable[[dict], None]


class ProviderAdapter(Protocol):
    """Contract for cloud provider adapters.

    Any class matching this shape satisfies the protocol without inheritance.
    """

    async def list_models(self) -> list[dict]:
        """Fetch available models. Uses cache when fresh."""
        ...

    async def generate_image(self, params: dict, on_progress: ProgressCallback) -> ImageResult:
        """Submit image generation, poll/stream progress, return result."""
        ...

    async def chat(self, params: dict, on_progress: ProgressCallback) -> ChatResult:
        """Submit chat completion, stream tokens, return result."""
        ...

    async def tts(self, params: dict) -> AudioResult:
        """Text-to-speech. Typically one-shot, no progress needed."""
        ...

    async def transcribe(self, params: dict) -> TranscribeResult:
        """Speech-to-text. One-shot."""
        ...

    async def generate_video(self, params: dict, on_progress: ProgressCallback) -> VideoResult:
        """Submit video generation, poll progress, return result."""
        ...

    async def cancel(self, remote_id: str) -> bool:
        """Attempt to cancel a running remote job."""
        ...

    async def probe_endpoints(self) -> dict[str, bool]:
        """Discover which endpoints this provider supports."""
        ...

    async def validate_key(self) -> bool:
        """Test if the configured API key is valid."""
        ...
