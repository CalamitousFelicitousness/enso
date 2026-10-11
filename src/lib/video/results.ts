import type { VideoResult } from "@/api/types/video";

// Still-mode results (frames <= 1 on modular models) arrive as a videos ref
// whose format is an image; a <video> element cannot display those, so
// viewers swap in an <img>. GIF is included because <video> cannot play it
// either, while <img> animates it natively.
export const STILL_FORMATS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

export function isStillResult(result: VideoResult): boolean {
  return STILL_FORMATS.has(result.format);
}

/** The job type a result came from: a cloud video's request names its provider. */
export function resultJobType(result: Pick<VideoResult, "domain" | "params">): string {
  if (result.domain !== "video") return result.domain;
  return "provider" in result.params ? "cloud_video" : "video";
}
