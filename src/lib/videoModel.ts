import type { LocalVideoEngineKind, LocalVideoModel, UnifiedModel } from "@/api/types/cloud";
import type { JobDomain } from "@/stores/jobStore";
import { isCloudVideoModel } from "@/lib/cloudVideo";

// Source of truth for "what should the Video panel render?" and "what
// JobDomain does this video request live under?". Driven by activeModel
// alone - there is no separate sub-tab state to consult.
//
// `"empty"` covers (a) no active model, (b) active model is non-video
// (local image checkpoint or cloud image model leaked from the Images
// view). The panel renders an empty-state hint in that case.

export type VideoUiKind = LocalVideoEngineKind | "cloud" | "empty";

export function isLocalVideoModel(m: UnifiedModel | null | undefined): m is LocalVideoModel {
  return m?.source === "local-video";
}

/** Fallback for models with no resolved caps: map an upstream engine name
 * to the form kind by name. Caps-carrying models use jobTypeToKind. */
export function engineToKind(engine: string): LocalVideoEngineKind {
  if (engine === "FramePack") return "framepack";
  if (engine === "LTX Video") return "ltx";
  return "generic";
}

/** The caps-declared job type is the authoritative kind source. */
export function jobTypeToKind(job: "video" | "ltx" | "framepack"): LocalVideoEngineKind {
  if (job === "framepack") return "framepack";
  if (job === "ltx") return "ltx";
  return "generic";
}

export function resolveVideoUi(m: UnifiedModel | null | undefined): VideoUiKind {
  if (isCloudVideoModel(m)) return "cloud";
  if (isLocalVideoModel(m)) return m.kind;
  return "empty";
}

/** JobDomain for a video request of the given UI kind. FramePack and LTX
 * have their own domains; generic and cloud share `"video"`. `"empty"`
 * shouldn't reach the submit path (canGenerate gates it), but defaults to
 * `"video"` to keep the type happy if it slips through. */
export function kindToDomain(kind: VideoUiKind): JobDomain {
  if (kind === "framepack") return "framepack";
  if (kind === "ltx") return "ltx";
  return "video";
}
