import type { VideoResult } from "@/api/types/video";

// Still-mode results (frames <= 1 on modular models) arrive as a videos ref
// whose format is an image; a <video> element cannot display those, so
// viewers swap in an <img>. GIF is included because <video> cannot play it
// either, while <img> animates it natively.
export const STILL_FORMATS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

export function isStillResult(result: VideoResult): boolean {
  return STILL_FORMATS.has(result.format);
}
