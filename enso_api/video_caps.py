"""Per-model video capability resolution for the V2 API.

Resolution layers, applied in order: schema defaults, the mode input
contract, every matching RULES entry in table order (later wins), the
engine provider overlay, then registry-derived fields. Every field ships
with an honest value; declared stand-ins for facts only a loaded pipe can
prove are named in ``unverified``.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from modules.logger import log

from enso_api.models import VideoModelCapsV2


def video_model_mode(model) -> str:
    """Mirror the dispatch order in video_run.run; rows the ladder cannot route report unknown."""
    if getattr(model, "workflow", None) is not None:
        return "workflow"
    lower = model.name.lower()
    if "flf2v" in lower:
        return "flf2v"
    if "vace" in lower:
        return "vace"
    if "animate" in lower:
        return "animate"
    if "i2v" in lower:
        return "i2v"
    if "t2v" in lower:
        return "t2v"
    return "unknown"


# per-mode input contract of video_run.run; i2v last_image rides a runtime
# signature probe (video_utils.supports_last_frame), hence unverified
MODE_CONTRACTS: dict[str, dict[str, Any]] = {
    "t2v": {"init_image": "ignored", "last_image": "ignored"},
    "i2v": {"init_image": "required", "last_image": "optional", "unverified": ["last_image"]},
    "flf2v": {"init_image": "required", "last_image": "required"},
    "vace": {"init_image": "optional", "last_image": "ignored"},
    "animate": {"init_image": "required", "last_image": "ignored"},
    "workflow": {},
    "unknown": {"init_image": "ignored", "last_image": "ignored"},
}


@dataclass(frozen=True)
class CapsRule:
    engine: str | None = None
    name_has: tuple[str, ...] = ()
    name_not: tuple[str, ...] = ()
    workflow: str | None = None
    caps: dict[str, Any] = field(default_factory=dict)

    def matches(self, engine: str, row) -> bool:
        if self.engine is not None and engine != self.engine:
            return False
        lower = row.name.lower()
        if any(s.lower() not in lower for s in self.name_has):
            return False
        if any(s.lower() in lower for s in self.name_not):
            return False
        return self.workflow is None or getattr(row, "workflow", None) == self.workflow


RULES: tuple[CapsRule, ...] = (
    CapsRule(
        engine="WAN Video",
        caps={
            # "Tiny" omitted: video_vae's 'WAN' class check never matches WanPipeline,
            # so tiny decode silently no-ops for Wan until that is fixed upstream
            "vae_types": ["Default", "Upscale"],
            "frame_rule.multiple": 4,
            "frame_rule.offset": 1,
            "frame_rule.min": 5,
            "frame_rule.max": 1021,
        },
    ),
    # expand_timesteps pipes accept last_image but mask only the first frame
    CapsRule(engine="WAN Video", name_has=("2.2 5B",), caps={"last_image": "ignored", "unverified": []}),
    CapsRule(engine="Hunyuan Video", caps={"vae_types": ["Default", "Tiny"]}),
    CapsRule(engine="Mochi Video", caps={"vae_types": ["Default", "Tiny"]}),
    CapsRule(engine="Kandinsky", caps={"vae_types": ["Default", "Tiny"]}),
    CapsRule(engine="Latte Video", caps={"frame_rule.multiple": 16, "frame_rule.min": 16}),
    CapsRule(
        engine="LTX Video",
        caps={
            "job_type": "ltx",
            "canvas_multiple": 32,
            "frame_rule.multiple": 8,
            "frame_rule.offset": 1,
            "frame_rule.min": 9,
            "frame_rule.max": 1017,
        },
    ),
    CapsRule(
        engine="MiniMax",
        caps={
            "canvas_multiple": 32,
            "frame_rule.multiple": 17,
            "frame_rule.offset": 5,
            "frame_rule.min": 124,
            "frame_rule.max": 345,
            "fps_fixed": 24,
            "max_duration": 15.0,
            "sampler.selectable": False,
            "sampler.fixed_name": "Default",
            "sampler.shift_applicable": False,
            "sampler.dynamic_shift_applicable": False,
            "guidance.cfg_applicable": False,
            "guidance.true_cfg_applicable": False,
            "guidance.negative_prompt_applicable": False,
            "guidance.distilled": True,
            "audio.produces_audio": True,
            "audio.gateable": True,
            "audio.sample_rate": 32000,
            "supports_still": True,
            "defaults.frames": 124,
            "defaults.steps": 30,
            "source": "minimax",
        },
    ),
    CapsRule(engine="MiniMax", workflow="fl2va", caps={"init_image": "optional", "last_image": "optional"}),
    # the V2 wire carries image references only; keyframe slots stay hidden on ref2va
    CapsRule(
        engine="MiniMax",
        workflow="ref2va",
        caps={
            "init_image": "ignored",
            "last_image": "ignored",
            "references.supported": True,
            "references.required": True,
            "references.max_images": 9,
            "references.max_total": 9,
            "references.ordered": True,
        },
    ),
    CapsRule(engine="Google Veo", caps={"remote": True}),
)


def apply_overlay(target: dict, overlay: dict[str, Any]) -> None:
    """Set dotted-key overlay values on a nested dict; lists are copied."""
    for key, value in overlay.items():
        node = target
        parts = key.split(".")
        for part in parts[:-1]:
            node = node[part]
        node[parts[-1]] = list(value) if isinstance(value, list) else value


def ltx_overlay(caps: dict, name: str) -> None:
    try:
        from modules.ltx import ltx_capabilities

        lc = ltx_capabilities.get_caps(name)
    except Exception as e:
        log.warning(f"Video caps: ltx overlay unavailable for {name}: {e}")
        return

    def g(attr: str, default):
        return getattr(lc, attr, default)

    variant = str(g("variant", "0.9"))
    produces_audio = bool(g("supports_audio", False))
    overlay: dict[str, Any] = {
        "source": "ltx",
        "gated_repo": variant == "2.5",
        "audio.produces_audio": produces_audio,
        "audio.gateable": produces_audio,
        "audio.sample_rate": (48000 if variant in ("2.3", "2.5") else 24000) if produces_audio else None,
        "stages.upsample": True,
        "stages.refine": True,
        "stages.auto_duration": bool(g("supports_auto_duration", False)),
        "stages.multi_condition": bool(g("supports_multi_condition", False)),
        "stages.stg": bool(g("supports_stg", False)),
        "stages.decode_timestep": bool(g("supports_decode_timestep", False)),
        "stages.image_cond_noise_scale": bool(g("supports_image_cond_noise_scale", False)),
        "guidance.distilled": bool(g("is_distilled", False)),
        "guidance.true_cfg_applicable": False,
        "init_strength_applicable": bool(g("supports_input_media", False)),
        "defaults.steps": int(g("default_steps", 50)),
        "defaults.guidance_scale": float(g("default_cfg", 4.0)),
        "defaults.sampler_shift": float(g("default_sampler_shift", -1.0)),
        "defaults.dynamic_shift": bool(g("default_dynamic_shift", False)),
        "defaults.width": int(g("default_width", 768)),
        "defaults.height": int(g("default_height", 512)),
        "defaults.frames": int(g("default_frames", 121)),
        "defaults.fps": int(g("default_frame_rate", 24)),
    }
    # the ltx path shows last_image only for multi-condition rows; no runtime probe involved
    if g("supports_multi_condition", False):
        overlay.update({"mode": "cond2v", "init_image": "optional", "last_image": "optional", "unverified": []})
    elif g("is_i2v", False):
        overlay.update({"mode": "i2v", "init_image": "required", "last_image": "ignored", "unverified": []})
    else:
        overlay.update({"init_image": "ignored", "last_image": "ignored", "unverified": []})
    apply_overlay(caps, overlay)


PROVIDERS: dict[str, Callable[[dict, str], None]] = {
    "LTX Video": ltx_overlay,
}


def resolve_caps(engine: str, row) -> VideoModelCapsV2:
    mode = video_model_mode(row)
    base = VideoModelCapsV2(engine=engine, model=row.name).model_dump()
    base["mode"] = mode
    base["workflow"] = getattr(row, "workflow", None)
    for key, value in MODE_CONTRACTS.get(mode, {}).items():
        base[key] = list(value) if isinstance(value, list) else value
    for rule in RULES:
        if rule.matches(engine, row):
            apply_overlay(base, rule.caps)
    provider = PROVIDERS.get(engine)
    if provider is not None:
        provider(base, row.name)
    if getattr(row, "vae_remote", False) and "Remote" not in base["vae_types"]:
        base["vae_types"] = [*base["vae_types"], "Remote"]
    return VideoModelCapsV2(**base)


def framepack_caps(variant: str) -> VideoModelCapsV2:
    base = VideoModelCapsV2(engine="FramePack", model=variant).model_dump()
    apply_overlay(
        base,
        {
            "job_type": "framepack",
            "init_image": "optional",
            "last_image": "optional",
            "sizing_mode": "resolution",
            "resolution_min": 240,
            "resolution_max": 1088,
            "resolution_multiple": 16,
            "length_mode": "duration",
            "duration_rule": {"min": 1.0, "max": 120.0, "step": 0.1},
            "vae_types": ["Full", "Tiny", "Remote"],
            "defaults.fps": 30,
            "defaults.steps": 25,
            "defaults.resolution": 640,
            "defaults.duration": 4.0,
            "source": "framepack",
        },
    )
    return VideoModelCapsV2(**base)


def all_caps() -> list[VideoModelCapsV2]:
    from modules.framepack import framepack_load
    from modules.video_models import models_def

    result: list[VideoModelCapsV2] = []
    for engine, rows in models_def.models.items():
        if engine == "None":
            continue
        for row in rows:
            if not models_def.is_model(row):
                continue
            result.append(resolve_caps(engine, row))
    for variant in framepack_load.models:
        result.append(framepack_caps(variant))
    return result


def dash_run(name: str) -> int:
    n = 0
    for ch in name:
        if ch != "─":
            break
        n += 1
    return n


def group_paths(rows) -> dict[str, list[str]]:
    """Group labels per model name, derived from separator rows; the dash-run length ranks the nesting level."""
    lengths = sorted({dash_run(r.name) for r in rows if r.name.startswith("─")}, reverse=True)
    level_of = {length: i for i, length in enumerate(lengths)}
    stack: list[str] = []
    result: dict[str, list[str]] = {}
    for row in rows:
        if row.name.startswith("─"):
            level = level_of[dash_run(row.name)]
            stack = [*stack[:level], row.name.strip("─").strip()]
        elif row.name != "None":
            result[row.name] = list(stack)
    return result
