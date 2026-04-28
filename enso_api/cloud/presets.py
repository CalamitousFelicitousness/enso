"""Provider presets - declarative endpoint routing and param maps.

Each preset encodes provider-specific knowledge: which endpoints exist,
how image generation is routed, and how Enso params map to API params.
"""

DEFAULT_CHAT_PARAMS = {
    "prompt": ("prompt", None),
    "temperature": ("temperature", lambda v: max(0.0, min(2.0, v))),
    "topP": ("top_p", lambda v: max(0.0, min(1.0, v))),
    "maxTokens": ("max_tokens", None),
    "seed": ("seed", lambda v: v if v >= 0 else None),
    "stop": ("stop", None),
}

DEFAULT_IMAGE_PARAMS = {
    "prompt": ("prompt", None),
    "negativePrompt": ("negative_prompt", None),
    "cfgScale": ("guidance_scale", lambda v: max(1.0, min(20.0, v))),
    "steps": ("num_inference_steps", lambda v: max(1, min(150, v))),
    "seed": ("seed", lambda v: v if v >= 0 else None),
    "batchSize": ("n", lambda v: max(1, min(10, v))),
    "denoisingStrength": ("strength", None),
}

DEFAULT_TTS_PARAMS = {
    "input": ("input", None),
    "voice": ("voice", None),
    "speed": ("speed", lambda v: max(0.25, min(4.0, v))),
    "responseFormat": ("response_format", None),
}


def _size_transform_wxh(w: int, h: int) -> dict:
    """Convert width/height to WxH string format."""
    return {"size": f"{w}x{h}"}


PRESETS: dict[str, dict] = {
    "openrouter": {
        "base_url": "https://openrouter.ai/api",
        "image_via": "chat",
        "model_list": ["/v1/models"],
        "model_list_params": {"output_modalities": "all"},
        "auth_header": "Bearer",
        "extra_headers": {"HTTP-Referer": "http://localhost", "X-Title": "Enso"},
        "param_maps": {
            "image": {
                "prompt": ("_message_content", None),
                "batchSize": ("n", lambda v: max(1, min(10, v))),
                "seed": ("seed", lambda v: v if v >= 0 else None),
            },
            "image_size_transform": _size_transform_wxh,
            "chat": DEFAULT_CHAT_PARAMS,
            "tts": DEFAULT_TTS_PARAMS,
        },
        "timeouts": {
            "cloud_image": 120,
            "cloud_chat": 120,
            "cloud_tts": 30,
            "cloud_stt": 60,
            "cloud_video": 900,
        },
    },
    "openai": {
        "base_url": "https://api.openai.com",
        "image_via": "images",
        "model_list": ["/v1/models"],
        "model_list_params": {},
        "auth_header": "Bearer",
        "extra_headers": {},
        "param_maps": {
            "image": {
                **DEFAULT_IMAGE_PARAMS,
                "quality": ("quality", None),
                "style": ("style", None),
            },
            "image_size_transform": _size_transform_wxh,
            "chat": DEFAULT_CHAT_PARAMS,
            "tts": DEFAULT_TTS_PARAMS,
        },
        "timeouts": {
            "cloud_image": 120,
            "cloud_chat": 120,
            "cloud_tts": 30,
            "cloud_stt": 60,
            "cloud_video": 600,
        },
    },
    "nanogpt": {
        "base_url": "https://nano-gpt.com/api",
        "image_via": "images",
        "model_list": ["/v1/models", "/v1/image-models", "/v1/video-models", "/v1/audio-models"],
        "model_list_params": {},
        "auth_header": "Bearer",
        "extra_headers": {},
        "param_maps": {
            "image": DEFAULT_IMAGE_PARAMS,
            "image_size_transform": _size_transform_wxh,
            "chat": DEFAULT_CHAT_PARAMS,
            "tts": DEFAULT_TTS_PARAMS,
        },
        "timeouts": {
            "cloud_image": 120,
            "cloud_chat": 120,
            "cloud_tts": 30,
            "cloud_stt": 60,
            "cloud_video": 600,
        },
    },
    "aihubmix": {
        "base_url": "https://aihubmix.com/v1",
        "image_via": "images",
        "model_list": ["/v1/models"],
        "model_list_params": {},
        "auth_header": "Bearer",
        "extra_headers": {},
        "param_maps": {
            "image": DEFAULT_IMAGE_PARAMS,
            "image_size_transform": _size_transform_wxh,
            "chat": DEFAULT_CHAT_PARAMS,
            "tts": DEFAULT_TTS_PARAMS,
        },
        "timeouts": {
            "cloud_image": 120,
            "cloud_chat": 120,
            "cloud_tts": 30,
            "cloud_stt": 60,
            "cloud_video": 600,
        },
    },
    "ollama": {
        "base_url": "http://localhost:11434",
        "image_via": "images",
        "model_list": ["/v1/models"],
        "model_list_params": {},
        "auth_header": None,
        "extra_headers": {},
        "vision_input": "base64_only",
        "param_maps": {
            "image": {
                "prompt": ("prompt", None),
                "seed": ("seed", lambda v: v if v >= 0 else None),
            },
            "image_size_transform": _size_transform_wxh,
            "chat": {
                "prompt": ("prompt", None),
                "temperature": ("temperature", lambda v: max(0.0, min(2.0, v))),
                "topP": ("top_p", lambda v: max(0.0, min(1.0, v))),
                "seed": ("seed", lambda v: v if v >= 0 else None),
                "stop": ("stop", None),
            },
            "tts": DEFAULT_TTS_PARAMS,
        },
        "timeouts": {
            "cloud_image": 300,
            "cloud_chat": 300,
            "cloud_tts": 60,
            "cloud_stt": 120,
            "cloud_video": 600,
        },
    },
    "custom": {
        "base_url": "",
        "image_via": "probe",
        "model_list": ["/v1/models"],
        "model_list_params": {},
        "auth_header": "Bearer",
        "extra_headers": {},
        "param_maps": {
            "image": DEFAULT_IMAGE_PARAMS,
            "image_size_transform": _size_transform_wxh,
            "chat": DEFAULT_CHAT_PARAMS,
            "tts": DEFAULT_TTS_PARAMS,
        },
        "timeouts": {
            "cloud_image": 120,
            "cloud_chat": 120,
            "cloud_tts": 30,
            "cloud_stt": 60,
            "cloud_video": 600,
        },
    },
}
