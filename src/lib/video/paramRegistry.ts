import type { FramePackParams, LtxParams, VideoParams } from "@/lib/openapi-generated/types.gen";

// Single source of truth for video generation params. The store slice type,
// defaults, preset membership, wire payload keys, and wire->store restore
// maps all derive from VIDEO_PARAMS; nothing else may enumerate these keys.

export type VideoJobType = "video" | "ltx" | "framepack";

export type ParamValueKind = "number" | "boolean" | "string" | "stringArray";

export type ParamGroup =
  | "prompt"
  | "sampling"
  | "size"
  | "inputs"
  | "decode"
  | "audio"
  | "output"
  | "styles"
  | "framepack"
  | "ltx"
  | "cloud";

/** Per-job-type wire key, typed against the generated wire params so a
 * stale or misspelled key fails tsc at the definition site. */
interface WireMap {
  video?: keyof VideoParams;
  ltx?: keyof LtxParams;
  framepack?: keyof FramePackParams;
}

interface ParamDefBase {
  group: ParamGroup;
  wire?: WireMap;
  /** Excluded from preset snapshots (prompts, client-only view state). */
  preset?: false;
}

type ParamDef = ParamDefBase &
  (
    | { kind: "number"; default: number }
    | { kind: "boolean"; default: boolean }
    | { kind: "string"; default: string }
    | { kind: "stringArray"; default: readonly string[] }
  );

export const VIDEO_PARAMS = {
  prompt: {
    kind: "string",
    default: "",
    group: "prompt",
    preset: false,
    wire: { video: "prompt", ltx: "prompt", framepack: "prompt" },
  },
  negative: {
    kind: "string",
    default: "",
    group: "prompt",
    preset: false,
    wire: { video: "negative", ltx: "negative", framepack: "negative" },
  },
  styles: {
    kind: "stringArray",
    default: [],
    group: "styles",
    preset: false,
    wire: { video: "styles", ltx: "styles", framepack: "styles" },
  },

  width: { kind: "number", default: 848, group: "size", wire: { video: "width", ltx: "width" } },
  height: { kind: "number", default: 480, group: "size", wire: { video: "height", ltx: "height" } },
  frames: { kind: "number", default: 25, group: "size", wire: { video: "frames", ltx: "frames" } },

  steps: { kind: "number", default: 30, group: "sampling", wire: { video: "steps" } },
  sampler: {
    kind: "number",
    default: 0,
    group: "sampling",
    wire: { video: "sampler", ltx: "sampler" },
  },
  samplerShift: {
    kind: "number",
    default: -1,
    group: "sampling",
    wire: { video: "sampler_shift" },
  },
  dynamicShift: {
    kind: "boolean",
    default: false,
    group: "sampling",
    wire: { video: "dynamic_shift" },
  },
  seed: {
    kind: "number",
    default: -1,
    group: "sampling",
    wire: { video: "seed", ltx: "seed", framepack: "seed" },
  },
  guidanceScale: {
    kind: "number",
    default: 6,
    group: "sampling",
    wire: { video: "guidance_scale" },
  },
  guidanceTrue: {
    kind: "number",
    default: -1,
    group: "sampling",
    wire: { video: "guidance_true" },
  },

  initStrength: { kind: "number", default: 0.5, group: "inputs", wire: { video: "init_strength" } },

  vaeType: { kind: "string", default: "Default", group: "decode", wire: { video: "vae_type" } },
  vaeTileFrames: {
    kind: "number",
    default: 0,
    group: "decode",
    wire: { video: "vae_tile_frames" },
  },

  audio: { kind: "boolean", default: true, group: "audio", wire: { video: "audio" } },

  fps: {
    kind: "number",
    default: 24,
    group: "output",
    wire: { video: "fps", ltx: "fps", framepack: "fps" },
  },
  interpolate: {
    kind: "number",
    default: 0,
    group: "output",
    wire: { video: "interpolate", ltx: "interpolate", framepack: "interpolate" },
  },
  codec: {
    kind: "string",
    default: "libx264",
    group: "output",
    wire: { video: "codec", ltx: "codec", framepack: "codec" },
  },
  format: {
    kind: "string",
    default: "mp4",
    group: "output",
    wire: { video: "format", ltx: "format", framepack: "format" },
  },
  codecOptions: {
    kind: "string",
    default: "crf:16",
    group: "output",
    wire: { video: "codec_options", ltx: "codec_options", framepack: "codec_options" },
  },
  outputPreset: { kind: "string", default: "balanced", group: "output" },
  outputQuality: { kind: "number", default: 70, group: "output" },
  saveVideo: {
    kind: "boolean",
    default: true,
    group: "output",
    wire: { video: "save_video", ltx: "save_video", framepack: "save_video" },
  },
  saveFrames: {
    kind: "boolean",
    default: false,
    group: "output",
    wire: { video: "save_frames", ltx: "save_frames", framepack: "save_frames" },
  },
  saveSafetensors: {
    kind: "boolean",
    default: false,
    group: "output",
    wire: { video: "save_safetensors", ltx: "save_safetensors", framepack: "save_safetensors" },
  },
  saveThumbnail: {
    kind: "boolean",
    default: true,
    group: "output",
    wire: { video: "save_thumbnail", ltx: "save_thumbnail", framepack: "save_thumbnail" },
  },

  fpResolution: {
    kind: "number",
    default: 640,
    group: "framepack",
    wire: { framepack: "resolution" },
  },
  fpDuration: { kind: "number", default: 4, group: "framepack", wire: { framepack: "duration" } },
  fpLatentWindowSize: {
    kind: "number",
    default: 9,
    group: "framepack",
    wire: { framepack: "latent_ws" },
  },
  fpSteps: { kind: "number", default: 25, group: "framepack", wire: { framepack: "steps" } },
  fpShift: { kind: "number", default: 3, group: "framepack", wire: { framepack: "shift" } },
  fpCfgScale: { kind: "number", default: 1, group: "framepack", wire: { framepack: "cfg_scale" } },
  fpCfgDistilled: {
    kind: "number",
    default: 10,
    group: "framepack",
    wire: { framepack: "cfg_distilled" },
  },
  fpCfgRescale: {
    kind: "number",
    default: 0,
    group: "framepack",
    wire: { framepack: "cfg_rescale" },
  },
  fpStartWeight: {
    kind: "number",
    default: 1,
    group: "framepack",
    wire: { framepack: "start_weight" },
  },
  fpEndWeight: {
    kind: "number",
    default: 1,
    group: "framepack",
    wire: { framepack: "end_weight" },
  },
  fpVisionWeight: {
    kind: "number",
    default: 1,
    group: "framepack",
    wire: { framepack: "vision_weight" },
  },
  fpSectionPrompt: {
    kind: "string",
    default: "",
    group: "framepack",
    wire: { framepack: "section_prompt" },
  },
  fpSystemPrompt: {
    kind: "string",
    default: "",
    group: "framepack",
    wire: { framepack: "system_prompt" },
  },
  fpTeacache: {
    kind: "boolean",
    default: true,
    group: "framepack",
    wire: { framepack: "use_teacache" },
  },
  fpOptimizedPrompt: {
    kind: "boolean",
    default: true,
    group: "framepack",
    wire: { framepack: "optimized_prompt" },
  },
  fpCfgZero: {
    kind: "boolean",
    default: false,
    group: "framepack",
    wire: { framepack: "use_cfgzero" },
  },
  fpPreview: {
    kind: "boolean",
    default: true,
    group: "framepack",
    wire: { framepack: "use_preview" },
  },
  fpAttention: {
    kind: "string",
    default: "Default",
    group: "framepack",
    wire: { framepack: "attention" },
  },
  fpVaeType: {
    kind: "string",
    default: "Full",
    group: "framepack",
    wire: { framepack: "vae_type" },
  },

  ltxSteps: { kind: "number", default: 50, group: "ltx", wire: { ltx: "steps" } },
  ltxDecodeTimestep: {
    kind: "number",
    default: 0.05,
    group: "ltx",
    wire: { ltx: "decode_timestep" },
  },
  ltxNoiseScale: {
    kind: "number",
    default: 0.025,
    group: "ltx",
    wire: { ltx: "image_cond_noise_scale" },
  },
  ltxUpsampleEnable: {
    kind: "boolean",
    default: false,
    group: "ltx",
    wire: { ltx: "upsample_enable" },
  },
  ltxUpsampleRatio: { kind: "number", default: 2, group: "ltx", wire: { ltx: "upsample_ratio" } },
  ltxRefineEnable: {
    kind: "boolean",
    default: false,
    group: "ltx",
    wire: { ltx: "refine_enable" },
  },
  ltxRefineStrength: {
    kind: "number",
    default: 0.4,
    group: "ltx",
    wire: { ltx: "refine_strength" },
  },
  ltxConditionStrength: {
    kind: "number",
    default: 0.8,
    group: "ltx",
    wire: { ltx: "condition_strength" },
  },
  ltxAudioEnable: {
    kind: "boolean",
    default: false,
    group: "audio",
    wire: { ltx: "audio_enable" },
  },

  cloudAspectRatio: { kind: "string", default: "16:9", group: "cloud", preset: false },
  cloudDuration: { kind: "number", default: 5, group: "cloud", preset: false },
} as const satisfies Record<string, ParamDef>;

export type VideoParamKey = keyof typeof VIDEO_PARAMS;

type ValueForKind<K extends ParamValueKind> = K extends "number"
  ? number
  : K extends "boolean"
    ? boolean
    : K extends "string"
      ? string
      : string[];

export type VideoParamValues = {
  -readonly [K in VideoParamKey]: ValueForKind<(typeof VIDEO_PARAMS)[K]["kind"]>;
};

export const VIDEO_PARAM_KEYS = Object.keys(VIDEO_PARAMS) as VideoParamKey[];

export const VIDEO_PARAM_DEFAULTS = Object.fromEntries(
  VIDEO_PARAM_KEYS.map((k) => [k, VIDEO_PARAMS[k].default]),
) as unknown as VideoParamValues;

const JOB_TYPES: readonly VideoJobType[] = ["video", "ltx", "framepack"];

export function wireKeyFor(key: VideoParamKey, job: VideoJobType): string | undefined {
  const def: ParamDef = VIDEO_PARAMS[key];
  return def.wire?.[job];
}

/** wire key -> store key per job type, derived by inversion so a stale
 * mapping is structurally impossible. */
export const WIRE_TO_STORE: Record<VideoJobType, Record<string, VideoParamKey>> = (() => {
  const out: Record<VideoJobType, Record<string, VideoParamKey>> = {
    video: {},
    ltx: {},
    framepack: {},
  };
  for (const key of VIDEO_PARAM_KEYS) {
    const def: ParamDef = VIDEO_PARAMS[key];
    if (!def.wire) continue;
    for (const job of JOB_TYPES) {
      const wireKey = def.wire[job];
      if (wireKey) out[job][wireKey] = key;
    }
  }
  return out;
})();

/** Preset membership: carried on the domain's wire, plus client-only output
 * view state; prompts and cloud state stay out. */
export function presetKeysFor(domain: VideoJobType): VideoParamKey[] {
  return VIDEO_PARAM_KEYS.filter((key) => {
    const def: ParamDef = VIDEO_PARAMS[key];
    if (def.preset === false) return false;
    return def.wire?.[domain] !== undefined || def.group === "output";
  });
}

export function coerce(
  kind: ParamValueKind,
  v: unknown,
): number | boolean | string | string[] | undefined {
  switch (kind) {
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? v : undefined;
    case "boolean":
      return typeof v === "boolean" ? v : undefined;
    case "string":
      return typeof v === "string" ? v : undefined;
    case "stringArray":
      return Array.isArray(v) && v.every((x) => typeof x === "string") ? v : undefined;
  }
}
