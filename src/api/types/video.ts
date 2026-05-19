import type { VideoWireParams } from "./wireParams";

export type {
  VideoEngine,
  VideoLoadResponse,
  VideoModel as VideoEngineModel,
  VideoModelEnriched as VideoModelDetail,
} from "@/lib/openapi-generated/types.gen";

// Local UI types — not in OpenAPI by design.
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
  params: VideoWireParams;
  domain: "video" | "framepack" | "ltx";
  timestamp: number;
}

export type VideoMode = "t2v" | "i2v" | "flf2v" | "vace" | "animate";
