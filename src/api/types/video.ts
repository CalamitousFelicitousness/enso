import type { VideoModelEnriched } from "@/lib/openapi-generated/types.gen";
import type { VideoWireParams } from "./wireParams";

export type {
  VideoEngine,
  VideoLoadResponse,
  VideoModel as VideoEngineModel,
  VideoModelEnriched as VideoModelDetail,
} from "@/lib/openapi-generated/types.gen";

// The codegen marks Pydantic-defaulted response fields optional, but the
// server always serializes every field; DeepRequired restores the truth.
type DeepRequired<T> = T extends (infer U)[]
  ? DeepRequired<U>[]
  : T extends object
    ? { [K in keyof T]-?: DeepRequired<T[K]> }
    : T;

export type VideoModelCaps = DeepRequired<
  import("@/lib/openapi-generated/types.gen").VideoModelCapsV2
>;

// Derived from VideoModelEnriched.mode so the narrowing is always in
// lockstep with the Pydantic-side Literal in enso_api/models.py.
export type VideoMode = VideoModelEnriched["mode"];

// Local UI types - not in OpenAPI by design.
//
// VideoResult is a store shape composed after the wire response arrives;
// it pulls in VideoWireParams (legacy alias scaffolding for PNG-metadata
// restore) plus the camelCase fields the UI store uses.

export interface VideoResult {
  id: string;
  videoUrl: string;
  thumbnailUrl?: string | undefined;
  width: number;
  height: number;
  format: string;
  size: number;
  /** Reported by cloud providers via VideoRef.duration. Local pipelines
   * compute duration from frames/fps client-side and leave this undefined. */
  duration?: number | null | undefined;
  /** Playback rate probed from the saved container; differs from the
   * requested rate under interpolation. */
  fps?: number | null | undefined;
  hasAudio?: boolean | undefined;
  frames?: number | null | undefined;
  params: VideoWireParams;
  domain: "video" | "framepack" | "ltx";
  timestamp: number;
}
