"""OpenAI-compatible provider adapter.

Handles all providers that implement the OpenAI API spec (OpenRouter, OpenAI,
NanoGPT, AIHubMix, Ollama, custom endpoints). Parameterized by preset - not
subclassed per provider.
"""

import base64
import logging
import struct

import httpx

log = logging.getLogger("enso_api.cloud")

from enso_api.cloud.config import ProviderConfig
from enso_api.cloud.errors import ProviderError
from enso_api.cloud.presets import resolve_input_limits
from enso_api.cloud.protocol import (
    AudioResult,
    ChatResult,
    CloudUsage,
    ImageResult,
    ProgressCallback,
    TranscribeResult,
    VideoResult,
)
from enso_api.cloud.transport import HttpTransport


class OpenAICompatAdapter:
    """Satisfies ProviderAdapter protocol via structural typing."""

    def __init__(self, config: ProviderConfig, transport: HttpTransport, preset: dict):
        self.config = config
        self.http = transport
        self.preset = preset

    async def list_models(self) -> list[dict]:
        all_models = []
        endpoints = self.preset.get("model_list", ["/v1/models"])
        params = self.preset.get("model_list_params", {})

        for endpoint in endpoints:
            try:
                data = await self.http.get_cached(endpoint, ttl=300, params=params or None)
                if isinstance(data, dict) and "data" in data:
                    models = data["data"]
                elif isinstance(data, list):
                    models = data
                else:
                    continue
                for model in models:
                    if isinstance(model, dict):
                        model["_source_endpoint"] = endpoint
                        all_models.append(model)
            except Exception:
                continue

        return self._normalize_models(all_models)

    async def generate_image(self, params: dict, on_progress: ProgressCallback) -> ImageResult:
        on_progress({"type": "cloud_progress", "phase": "submitted"})

        has_image = bool(params.get("image"))
        image_via = self.preset.get("image_via", "images")

        if has_image and image_via == "images":
            return await self._generate_image_edit(params, on_progress)
        if has_image and image_via == "dataurl":
            return await self._generate_image_via_dataurl(params, on_progress)
        if image_via == "chat":
            return await self._generate_image_via_chat(params, on_progress)
        return await self._generate_image_via_endpoint(params, on_progress)

    async def chat(self, params: dict, on_progress: ProgressCallback) -> ChatResult:
        on_progress({"type": "cloud_progress", "phase": "submitted"})

        messages = params.get("messages", [])
        if not messages and params.get("prompt"):
            messages = [{"role": "user", "content": params["prompt"]}]

        body = {"model": params["model"], "messages": messages}
        chat_map = self.preset.get("param_maps", {}).get("chat", {})
        for enso_name, value in params.items():
            if enso_name in ("model", "messages", "prompt", "provider", "type", "priority", "extra_params"):
                continue
            mapping = chat_map.get(enso_name)
            if mapping is None:
                continue
            api_name, transform = mapping if isinstance(mapping, tuple) else (mapping, None)
            if api_name is None:
                continue
            result_val = transform(value) if transform else value
            if result_val is not None:
                body[api_name] = result_val

        if params.get("extra_params"):
            body.update(params["extra_params"])

        on_progress({"type": "cloud_progress", "phase": "processing"})
        data = await self.http.post("/v1/chat/completions", json=body)

        choice = data.get("choices", [{}])[0]
        message = choice.get("message", {})
        usage_data = data.get("usage")

        return ChatResult(
            content=message.get("content", ""),
            tool_calls=message.get("tool_calls"),
            finish_reason=choice.get("finish_reason", "stop"),
            usage=self._parse_usage(usage_data),
        )

    async def tts(self, params: dict) -> AudioResult:
        body = {"model": params["model"]}
        tts_map = self.preset.get("param_maps", {}).get("tts", {})
        for enso_name, value in params.items():
            if enso_name in ("model", "provider", "type", "priority"):
                continue
            mapping = tts_map.get(enso_name)
            if mapping is None:
                continue
            api_name, transform = mapping if isinstance(mapping, tuple) else (mapping, None)
            if api_name is None:
                continue
            result_val = transform(value) if transform else value
            if result_val is not None:
                body[api_name] = result_val

        response = await self.http.client.post(
            "/v1/audio/speech",
            json=body,
            headers=self.http.client.headers,
        )
        if response.status_code >= 400:
            self.http.raise_for_status(response)

        fmt = params.get("response_format", "mp3")
        return AudioResult(data=response.content, format=fmt)

    async def transcribe(self, params: dict) -> TranscribeResult:
        audio_data = params.get("audio", b"")
        if isinstance(audio_data, str):
            audio_data = base64.b64decode(audio_data)

        files = {"file": ("audio.wav", audio_data, "audio/wav")}
        data_fields = {"model": params["model"]}
        if params.get("language"):
            data_fields["language"] = params["language"]

        response = await self.http.client.post(
            "/v1/audio/transcriptions",
            files=files,
            data=data_fields,
            headers={k: v for k, v in self.http.client.headers.items() if k.lower() != "content-type"},
        )
        if response.status_code >= 400:
            self.http.raise_for_status(response)

        result = response.json()
        return TranscribeResult(
            text=result.get("text", ""),
            language=result.get("language"),
            segments=result.get("segments"),
            duration=result.get("duration"),
        )

    async def generate_video(self, params: dict, on_progress: ProgressCallback) -> VideoResult:
        on_progress({"type": "cloud_progress", "phase": "submitted"})

        body = {
            "model": params["model"],
            "prompt": params.get("prompt", ""),
        }
        if params.get("aspect_ratio"):
            body["aspect_ratio"] = params["aspect_ratio"]
        if params.get("duration"):
            body["duration"] = params["duration"]
        if params.get("size"):
            body["size"] = params["size"]
        if params.get("extra_params"):
            body.update(params["extra_params"])

        data = await self.http.post("/v1/videos", json=body)
        video_id = data.get("id")
        if not video_id:
            raise ProviderError("No video job ID returned", provider=self.config.id)

        on_progress({"type": "cloud_progress", "phase": "queued_remote"})
        return await self._poll_video(video_id, on_progress)

    async def cancel(self, remote_id: str) -> bool:
        try:
            await self.http.post(f"/v1/videos/{remote_id}/cancel", json={})
            return True
        except Exception:
            return False

    async def probe_endpoints(self) -> dict[str, bool]:
        results = {}
        probe_paths = [
            ("models", "/v1/models"),
            ("chat", "/v1/chat/completions"),
            ("images", "/v1/images/generations"),
            ("audio_speech", "/v1/audio/speech"),
            ("audio_transcriptions", "/v1/audio/transcriptions"),
            ("video", "/v1/videos"),
        ]
        for name, path in probe_paths:
            try:
                response = await self.http.client.request("OPTIONS", path)
                results[name] = response.status_code < 500
            except Exception:
                try:
                    response = await self.http.client.get(path)
                    results[name] = response.status_code != 404
                except Exception:
                    results[name] = False
        return results

    async def validate_key(self) -> bool:
        try:
            endpoints = self.preset.get("model_list", ["/v1/models"])
            await self.http.get(endpoints[0], params={"limit": "1"})
            return True
        except Exception:
            return False

    # --- Private helpers ---

    async def _generate_image_via_endpoint(self, params: dict, on_progress: ProgressCallback) -> ImageResult:
        body = self._build_image_params(params)
        body["model"] = params["model"]

        log.debug("Cloud image request: %s", body)

        on_progress({"type": "cloud_progress", "phase": "processing"})
        data = await self.http.post("/v1/images/generations", json=body)

        on_progress({"type": "cloud_progress", "phase": "downloading"})
        images = await self._extract_images(data)
        usage_data = data.get("usage")

        return ImageResult(
            images=images,
            revised_prompt=data.get("data", [{}])[0].get("revised_prompt") if data.get("data") else None,
            format="png",
            usage=self._parse_usage(usage_data),
        )

    async def _generate_image_edit(self, params: dict, on_progress: ProgressCallback) -> ImageResult:
        """Multipart image edit via /v1/images/edits (OpenAI pattern)."""
        on_progress({"type": "cloud_progress", "phase": "processing"})

        image_data = await self._resolve_upload_ref(params["image"])
        self._validate_input_image(image_data, params["model"])
        files: dict = {"image": ("input.png", image_data, "image/png")}
        data_fields: dict = {
            "model": params["model"],
            "prompt": params.get("prompt", ""),
        }

        if params.get("size"):
            data_fields["size"] = params["size"]
        if params.get("n"):
            data_fields["n"] = str(params["n"])

        if params.get("mask"):
            mask_data = await self._resolve_upload_ref(params["mask"])
            mask_data = self._invert_mask_for_openai(mask_data)
            files["mask"] = ("mask.png", mask_data, "image/png")

        response = await self.http.client.post(
            "/v1/images/edits",
            files=files,
            data=data_fields,
            headers={k: v for k, v in self.http.client.headers.items() if k.lower() != "content-type"},
        )
        if response.status_code >= 400:
            self.http.raise_for_status(response)

        result_data = response.json()
        on_progress({"type": "cloud_progress", "phase": "downloading"})
        images = await self._extract_images(result_data)

        return ImageResult(
            images=images,
            revised_prompt=result_data.get("data", [{}])[0].get("revised_prompt") if result_data.get("data") else None,
            format="png",
            usage=self._parse_usage(result_data.get("usage")),
        )

    async def _generate_image_via_dataurl(self, params: dict, on_progress: ProgressCallback) -> ImageResult:
        """Img2img via imageDataUrl in JSON body (NanoGPT pattern)."""
        on_progress({"type": "cloud_progress", "phase": "processing"})

        image_data = await self._resolve_upload_ref(params["image"])
        self._validate_input_image(image_data, params["model"])

        fmt = "png"
        if image_data[:2] == b"\xff\xd8":
            fmt = "jpeg"
        elif image_data[:4] == b"RIFF" and image_data[8:12] == b"WEBP":
            fmt = "webp"
        b64 = base64.b64encode(image_data).decode()

        body = self._build_image_params(params)
        body["model"] = params["model"]
        body["imageDataUrl"] = f"data:image/{fmt};base64,{b64}"

        if params.get("mask"):
            mask_data = await self._resolve_upload_ref(params["mask"])
            mask_b64 = base64.b64encode(mask_data).decode()
            body["maskDataUrl"] = f"data:image/png;base64,{mask_b64}"

        on_progress({"type": "cloud_progress", "phase": "processing"})
        data = await self.http.post("/v1/images/generations", json=body)

        on_progress({"type": "cloud_progress", "phase": "downloading"})
        images = await self._extract_images(data)

        return ImageResult(
            images=images,
            revised_prompt=data.get("data", [{}])[0].get("revised_prompt") if data.get("data") else None,
            format="png",
            usage=self._parse_usage(data.get("usage")),
        )

    async def _resolve_upload_ref(self, ref: str) -> bytes:
        """Resolve an upload reference (upload:<id>, URL path, http URL, or base64) to raw bytes."""
        if ref.startswith("upload:"):
            from enso_api.upload import get_upload_store
            ref_id = ref.split(":", 1)[1]
            entry = get_upload_store().get(ref_id)
            if entry is None:
                raise ProviderError(f"Upload {ref} not found or expired", provider=self.config.id)
            with open(entry.path, "rb") as f:
                return f.read()
        if ref.startswith("/sdapi/v2/uploads/") or ref.startswith("http"):
            url = ref if ref.startswith("http") else f"{self.http.client.base_url}{ref}"
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.get(url)
                return response.content
        return base64.b64decode(ref)

    def _invert_mask_for_openai(self, mask_bytes: bytes) -> bytes:
        """Invert mask: Enso uses white=editable, OpenAI uses alpha=0 for editable.

        Converts white-on-black mask to RGBA where white regions become transparent.
        """
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(mask_bytes)).convert("L")
        rgba = Image.new("RGBA", img.size, (0, 0, 0, 255))
        alpha = img.point(lambda p: 0 if p > 128 else 255)
        rgba.putalpha(alpha)
        buf = io.BytesIO()
        rgba.save(buf, format="PNG")
        return buf.getvalue()

    def _validate_input_image(self, image_data: bytes, model_id: str) -> None:
        """Validate image size and dimensions against provider limits."""
        limits = resolve_input_limits(self.preset, model_id)
        max_bytes = limits.get("max_image_bytes")
        if max_bytes and len(image_data) > max_bytes:
            size_mb = len(image_data) / 1_000_000
            limit_mb = max_bytes / 1_000_000
            raise ProviderError(
                f"Image too large ({size_mb:.1f} MB). "
                f"Provider limit is {limit_mb:.1f} MB. "
                f"Reduce canvas resolution or image count.",
                provider=self.config.id,
            )
        max_side = limits.get("max_longest_side")
        if max_side:
            dims = self._read_image_dimensions(image_data)
            if dims and max(dims) > max_side:
                raise ProviderError(
                    f"Image dimensions {dims[0]}x{dims[1]} exceed provider limit "
                    f"of {max_side}px on longest side.",
                    provider=self.config.id,
                )

    @staticmethod
    def _read_image_dimensions(data: bytes) -> tuple[int, int] | None:
        """Read width/height from PNG or JPEG header without full decode."""
        if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
            w, h = struct.unpack(">II", data[16:24])
            return (w, h)
        if data[:2] == b"\xff\xd8":
            offset = 2
            while offset < len(data) - 8:
                if data[offset] != 0xFF:
                    break
                marker = data[offset + 1]
                length = struct.unpack(">H", data[offset + 2:offset + 4])[0]
                if marker in (0xC0, 0xC2):
                    h = struct.unpack(">H", data[offset + 5:offset + 7])[0]
                    w = struct.unpack(">H", data[offset + 7:offset + 9])[0]
                    return (w, h)
                offset += 2 + length
        return None

    async def _generate_image_via_chat(self, params: dict, on_progress: ProgressCallback) -> ImageResult:
        prompt = params.get("prompt", "")
        content: list[dict] | str = prompt

        if params.get("image"):
            image_data = await self._resolve_upload_ref(params["image"])
            self._validate_input_image(image_data, params["model"])
            fmt = "png"
            if image_data[:2] == b"\xff\xd8":
                fmt = "jpeg"
            elif image_data[:4] == b"RIFF" and image_data[8:12] == b"WEBP":
                fmt = "webp"
            b64 = base64.b64encode(image_data).decode()
            content = [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/{fmt};base64,{b64}"}},
            ]

        body: dict = {
            "model": params["model"],
            "messages": [{"role": "user", "content": content}],
            "modalities": ["image"],
        }
        image_map = self.preset.get("param_maps", {}).get("image", {})
        for enso_name, value in params.items():
            if enso_name in ("model", "prompt", "provider", "type", "priority", "extra_params", "width", "height", "image", "mask"):
                continue
            mapping = image_map.get(enso_name)
            if mapping is None:
                continue
            api_name, transform = mapping if isinstance(mapping, tuple) else (mapping, None)
            if api_name is None or api_name.startswith("_"):
                continue
            result_val = transform(value) if transform else value
            if result_val is not None:
                body[api_name] = result_val

        size_fn = self.preset.get("param_maps", {}).get("image_size_transform")
        if size_fn and params.get("width") and params.get("height"):
            body.update(size_fn(params["width"], params["height"]))

        if params.get("extra_params"):
            body.update(params["extra_params"])

        on_progress({"type": "cloud_progress", "phase": "processing"})
        data = await self.http.post("/v1/chat/completions", json=body)

        on_progress({"type": "cloud_progress", "phase": "downloading"})
        images = self._extract_images_from_chat(data)
        usage_data = data.get("usage")

        return ImageResult(
            images=images,
            format="png",
            usage=self._parse_usage(usage_data),
        )

    def _build_image_params(self, params: dict) -> dict:
        image_map = self.preset.get("param_maps", {}).get("image", {})
        api_params = {}

        for enso_name, value in params.items():
            if enso_name in ("provider", "model", "type", "priority", "extra_params", "width", "height", "image", "mask"):
                continue
            mapping = image_map.get(enso_name)
            if mapping is None:
                continue
            api_name, transform = mapping if isinstance(mapping, tuple) else (mapping, None)
            if api_name is None or api_name.startswith("_"):
                continue
            result_val = transform(value) if transform else value
            if result_val is not None:
                api_params[api_name] = result_val

        size_fn = self.preset.get("param_maps", {}).get("image_size_transform")
        if size_fn and params.get("width") and params.get("height"):
            api_params.update(size_fn(params["width"], params["height"]))

        if params.get("extra_params"):
            api_params.update(params["extra_params"])

        return api_params

    async def _extract_images(self, data: dict) -> list[bytes]:
        images = []
        for item in data.get("data", []):
            if item.get("b64_json"):
                images.append(base64.b64decode(item["b64_json"]))
            elif item.get("url"):
                img_bytes = await self._download_url(item["url"])
                if img_bytes:
                    images.append(img_bytes)
        return images

    def _extract_images_from_chat(self, data: dict) -> list[bytes]:
        images = []
        choices = data.get("choices", [])
        for choice in choices:
            message = choice.get("message", {})
            content = message.get("content")
            if isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "image_url":
                        url_data = part.get("image_url", {}).get("url", "")
                        if url_data.startswith("data:"):
                            b64 = url_data.split(",", 1)[1] if "," in url_data else ""
                            images.append(base64.b64decode(b64))
                    elif isinstance(part, dict) and part.get("type") == "image":
                        b64 = part.get("data", "") or part.get("b64_json", "")
                        if b64:
                            images.append(base64.b64decode(b64))
        return images

    async def _download_url(self, url: str) -> bytes | None:
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.get(url)
                if response.status_code == 200:
                    return response.content
        except Exception:
            pass
        return None

    async def _poll_video(self, video_id: str, on_progress: ProgressCallback) -> VideoResult:
        import asyncio
        max_polls = 120
        interval = 5.0

        for _ in range(max_polls):
            await asyncio.sleep(interval)
            try:
                data = await self.http.get(f"/v1/videos/{video_id}")
            except Exception:
                continue

            status = data.get("status", "")
            progress = data.get("progress", 0)

            if status == "completed":
                on_progress({"type": "cloud_progress", "phase": "downloading", "progress": 0.9})
                video_bytes = await self._download_video_content(video_id, data)
                return VideoResult(
                    data=video_bytes,
                    format="mp4",
                    duration=data.get("seconds") or data.get("duration"),
                )

            if status == "failed":
                error = data.get("error", {})
                msg = error.get("message", "Video generation failed") if isinstance(error, dict) else str(error)
                raise ProviderError(msg, provider=self.config.id)

            on_progress({
                "type": "cloud_progress",
                "phase": "processing",
                "progress": progress / 100 if progress > 1 else progress,
            })

        raise ProviderError("Video generation timed out", provider=self.config.id)

    async def _download_video_content(self, video_id: str, data: dict) -> bytes:
        urls = data.get("unsigned_urls") or data.get("urls") or []
        if isinstance(urls, list) and urls:
            video_bytes = await self._download_url(urls[0])
            if video_bytes:
                return video_bytes

        try:
            response = await self.http.client.get(f"/v1/videos/{video_id}/content")
            if response.status_code == 200:
                return response.content
        except Exception:
            pass

        raise ProviderError("Failed to download video content", provider=self.config.id)

    IMAGE_SIZE_CONSTRAINTS: dict[str, list[str]] = {
        "dall-e-2": ["256x256", "512x512", "1024x1024"],
        "dall-e-3": ["1024x1024", "1024x1792", "1792x1024"],
        "gpt-image-1": ["1024x1024", "1536x1024", "1024x1536", "auto"],
        "gpt-image-1-mini": ["1024x1024", "1536x1024", "1024x1536", "auto"],
    }

    def _normalize_models(self, raw_models: list[dict]) -> list[dict]:
        normalized = []
        for m in raw_models:
            model_id = m.get("id", "")
            if not model_id:
                continue

            modalities = self._infer_modalities(m)
            capabilities = self._infer_capabilities(m)
            pricing = self._extract_pricing(m)
            supported_params = self._extract_supported_params(m) or []

            has_size_enum = any(p.get("name") == "size" for p in supported_params)
            if not has_size_enum:
                size_options = (
                    self._get_size_constraints(model_id)
                    or self._extract_resolutions_from_pricing(m)
                )
                if size_options:
                    supported_params.append({
                        "name": "size",
                        "type": "enum",
                        "options": size_options,
                        "default": size_options[0],
                    })

            normalized.append({
                "source": "cloud",
                "id": model_id,
                "name": m.get("name") or model_id.split("/")[-1],
                "provider": self.config.id,
                "modalities": modalities,
                "capabilities": capabilities,
                "pricing": pricing,
                "context_length": m.get("context_length") or m.get("max_model_len"),
                "supported_params": supported_params or None,
                "description": m.get("description"),
                "default_params": m.get("default_parameters"),
            })
        return normalized

    def _get_size_constraints(self, model_id: str) -> list[str] | None:
        bare_id = model_id.split("/")[-1] if "/" in model_id else model_id
        for family, sizes in self.IMAGE_SIZE_CONSTRAINTS.items():
            if bare_id == family or bare_id.startswith(f"{family}:"):
                return sizes
        return None

    def _infer_modalities(self, m: dict) -> list[str]:
        modalities = []
        arch = m.get("architecture", {})
        output_mods = arch.get("output_modalities", [])
        input_mods = arch.get("input_modalities", [])

        if "image" in output_mods:
            modalities.append("text-to-image")
        if "image" in input_mods and "image" in output_mods:
            modalities.append("image-to-image")
        if "text" in output_mods:
            modalities.append("chat")
        if "image" in input_mods and "text" in output_mods:
            modalities.append("vision")
        if "audio" in output_mods:
            modalities.append("audio-out")
        if "audio" in input_mods:
            modalities.append("audio-in")
        if "video" in output_mods:
            modalities.append("text-to-video")

        if not modalities:
            modalities.append("chat")

        return modalities

    def _infer_capabilities(self, m: dict) -> list[str]:
        caps = []
        supported = m.get("supported_parameters", [])
        if isinstance(supported, dict):
            caps.append("streaming")
            return caps
        if "tools" in supported:
            caps.append("tools")
        if "structured_outputs" in supported or "response_format" in supported:
            caps.append("structured-output")
        if "seed" in supported:
            caps.append("seed")
        if "reasoning" in supported or "reasoning_effort" in supported:
            caps.append("reasoning")
        caps.append("streaming")
        return caps

    def _extract_pricing(self, m: dict) -> dict | None:
        pricing = m.get("pricing")
        if not pricing or not isinstance(pricing, dict):
            return None
        result = {"currency": "USD"}
        if pricing.get("prompt"):
            result["prompt_token"] = pricing["prompt"]
        if pricing.get("completion"):
            result["completion_token"] = pricing["completion"]
        if pricing.get("image"):
            result["per_image"] = pricing["image"]
        if pricing.get("request"):
            result["per_request"] = pricing["request"]
        if pricing.get("input_cache_read"):
            result["cache_read_token"] = pricing["input_cache_read"]
        if pricing.get("input_cache_write"):
            result["cache_write_token"] = pricing["input_cache_write"]
        return result if len(result) > 1 else None

    def _extract_supported_params(self, m: dict) -> list[dict] | None:
        supported = m.get("supported_parameters")
        if not supported:
            return None
        if isinstance(supported, dict):
            return self._extract_supported_params_dict(supported)
        if isinstance(supported, list):
            return self._extract_supported_params_list(supported)
        return None

    def _extract_supported_params_dict(self, supported: dict) -> list[dict] | None:
        """Handle NanoGPT format: {"resolutions": [...], "max_images": 4, ...}."""
        descriptors = []
        resolutions = supported.get("resolutions")
        if resolutions and isinstance(resolutions, list):
            options = [r.replace("*", "x") for r in resolutions]
            descriptors.append({
                "name": "size",
                "type": "enum",
                "options": options,
                "default": options[0],
            })
        return descriptors or None

    def _extract_supported_params_list(self, supported: list) -> list[dict] | None:
        """Handle OpenRouter format: ["temperature", "top_p", ...]."""
        descriptors = []
        param_schemas = {
            "temperature": {"type": "float", "min": 0.0, "max": 2.0, "step": 0.1, "default": 1.0},
            "top_p": {"type": "float", "min": 0.0, "max": 1.0, "step": 0.05, "default": 1.0},
            "top_k": {"type": "int", "min": 1, "max": 200, "default": 50},
            "max_tokens": {"type": "int", "min": 1, "max": 128000},
            "max_completion_tokens": {"type": "int", "min": 1, "max": 128000},
            "frequency_penalty": {"type": "float", "min": -2.0, "max": 2.0, "step": 0.1, "default": 0.0},
            "presence_penalty": {"type": "float", "min": -2.0, "max": 2.0, "step": 0.1, "default": 0.0},
            "repetition_penalty": {"type": "float", "min": 0.0, "max": 2.0, "step": 0.1, "default": 1.0},
            "seed": {"type": "int", "min": -1, "max": 2147483647},
        }
        for param_name in supported:
            schema = param_schemas.get(param_name)
            if schema:
                descriptors.append({"name": param_name, **schema})
            else:
                descriptors.append({"name": param_name, "type": "string"})
        return descriptors or None

    def _extract_resolutions_from_pricing(self, m: dict) -> list[str] | None:
        """Fallback: infer supported sizes from pricing keys like {"1024*1024": 0.017}."""
        pricing = m.get("pricing")
        if not pricing or not isinstance(pricing, dict):
            return None
        per_image = pricing.get("per_image")
        if not isinstance(per_image, dict):
            return None
        resolutions = []
        for key in per_image:
            normalized = key.replace("*", "x")
            parts = normalized.split("x")
            if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
                resolutions.append(normalized)
        return resolutions or None

    def _parse_usage(self, usage_data: dict | None) -> CloudUsage | None:
        if not usage_data:
            return None
        return CloudUsage(
            prompt_tokens=usage_data.get("prompt_tokens"),
            completion_tokens=usage_data.get("completion_tokens"),
            total_tokens=usage_data.get("total_tokens"),
            cost=usage_data.get("cost"),
        )
