// Job types as the server names them, and what the page makes of each: the
// flow that tracks the job and takes its result (its domain), its label and
// its icon. One table for the Queue and History cards, the tracker and
// rehydration.

import type { JobStatus } from "@/api/types/v2";

export type JobDomain =
  | "generate"
  | "upscale"
  | "rembg"
  | "process"
  | "preprocess"
  | "video"
  | "framepack"
  | "ltx"
  | "xyz-grid";

/** Names an icon; the cards map the name to a component. */
export type JobIcon =
  "image" | "video" | "sparkles" | "sliders" | "grid" | "message" | "scan" | "audio" | "database";

export interface JobKind {
  label: string;
  icon: JobIcon;
  /** The flow that tracks a job of this type; null for types the page never tracks. */
  domain: JobDomain | null;
}

const KINDS: Readonly<Record<string, JobKind>> = {
  generate: { label: "Image", icon: "image", domain: "generate" },
  detail: { label: "Detail", icon: "scan", domain: "generate" },
  cloud_image: { label: "Cloud image", icon: "image", domain: "generate" },
  "xyz-grid": { label: "XYZ Grid", icon: "grid", domain: "xyz-grid" },
  upscale: { label: "Upscale", icon: "sparkles", domain: "upscale" },
  rembg: { label: "Background removal", icon: "sparkles", domain: "rembg" },
  process: { label: "Process", icon: "sparkles", domain: "process" },
  preprocess: { label: "Preprocess", icon: "sliders", domain: "preprocess" },
  video: { label: "Video", icon: "video", domain: "video" },
  framepack: { label: "FramePack", icon: "video", domain: "framepack" },
  ltx: { label: "LTX", icon: "video", domain: "ltx" },
  cloud_video: { label: "Cloud video", icon: "video", domain: "video" },
  caption: { label: "Caption", icon: "message", domain: null },
  enhance: { label: "Enhance", icon: "sparkles", domain: null },
  detect: { label: "Detect", icon: "scan", domain: null },
  cloud_chat: { label: "Cloud chat", icon: "message", domain: null },
  cloud_tts: { label: "Text to speech", icon: "audio", domain: null },
  cloud_stt: { label: "Speech to text", icon: "audio", domain: null },
  "metadata-sweep": { label: "Metadata sweep", icon: "database", domain: null },
};

/** A type this build does not know keeps its server name. */
export function jobKind(type: string): JobKind {
  return KINDS[type] ?? { label: type, icon: "image", domain: null };
}

export type VideoDomain = Extract<JobDomain, "video" | "framepack" | "ltx">;

export const VIDEO_DOMAINS: readonly VideoDomain[] = ["video", "framepack", "ltx"];

export function isVideoDomain(domain: JobDomain): domain is VideoDomain {
  return VIDEO_DOMAINS.includes(domain);
}

/** Domains whose results reach a result strip. */
export function stripDomain(domain: JobDomain): boolean {
  return domain === "generate" || isVideoDomain(domain);
}

export function isTerminal(status: JobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}
