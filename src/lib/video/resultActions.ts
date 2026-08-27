import { toast } from "sonner";
import {
  extractFrameFromVideo,
  restoreVideoSettings,
  sendFrameToUpscale,
  sendFrameToVideoInit,
  sendFrameToVideoLast,
} from "@/lib/sendTo";
import { downloadImage, resolveImageSrc } from "@/lib/utils";
import type { VideoResult } from "@/api/types/video";

// Past the end of any clip; the extractor clamps to the real duration.
const LAST_FRAME = 999999;

// Every frame verb is extract-then-place, and a failed decode reports once.
async function withFrame(
  result: VideoResult,
  time: number,
  place: (blob: Blob) => void,
  message: string,
) {
  try {
    place(await extractFrameFromVideo(resolveImageSrc(result.videoUrl), time));
    toast.success(message);
  } catch {
    toast.error("Failed to extract frame");
  }
}

export function sendFirstFrameToInit(result: VideoResult) {
  return withFrame(
    result,
    0,
    (blob) => void sendFrameToVideoInit(blob),
    "First frame sent to Init Image",
  );
}

export function sendLastFrameToInit(result: VideoResult) {
  return withFrame(
    result,
    LAST_FRAME,
    (blob) => void sendFrameToVideoInit(blob),
    "Last frame sent to Init Image",
  );
}

export function sendLastFrameToLast(result: VideoResult) {
  return withFrame(
    result,
    LAST_FRAME,
    (blob) => void sendFrameToVideoLast(blob),
    "Last frame sent to Last Image",
  );
}

export function sendFrameToUpscaleFrom(result: VideoResult) {
  return withFrame(result, 0, sendFrameToUpscale, "Frame sent to Upscale");
}

export function extendFrom(result: VideoResult) {
  return withFrame(
    result,
    LAST_FRAME,
    (blob) => {
      void sendFrameToVideoInit(blob);
      restoreVideoSettings(result.params, result.domain);
    },
    "Ready to extend video",
  );
}

export function reuseSettings(result: VideoResult) {
  restoreVideoSettings(result.params, result.domain);
  toast.success("Video settings restored");
}

export function sendCapturedFrameToInit(blob: Blob) {
  void sendFrameToVideoInit(blob);
  toast.success("Captured frame sent to Init Image");
}

export function downloadResult(result: VideoResult) {
  const stamp = new Date(result.timestamp).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  void downloadImage(resolveImageSrc(result.videoUrl), `enso-${stamp}.${result.format}`);
}
