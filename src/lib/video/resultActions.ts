import { toast } from "sonner";
import {
  extractFrameFromVideo,
  restoreVideoSettings,
  sendFrameToUpscale,
  sendFrameToVideoInit,
  sendFrameToVideoLast,
} from "@/lib/sendTo";
import { mediaSrc } from "@/api/session";
import { downloadMedia, failedWith } from "@/lib/mediaFiles";
import type { VideoResult } from "@/api/types/video";

// Past the end of any clip; the extractor clamps to the real duration.
const LAST_FRAME = 999999;

// Every frame verb is extract-then-place, and a failed decode reports once.
async function withFrame(
  result: VideoResult,
  time: number,
  place: (blob: Blob) => Promise<boolean>,
  message: string,
) {
  let frame: Blob;
  try {
    frame = await extractFrameFromVideo(mediaSrc(result.videoUrl), time);
  } catch {
    toast.error("Failed to extract frame");
    return;
  }
  if (await place(frame)) toast.success(message);
}

export function sendFirstFrameToInit(result: VideoResult) {
  return withFrame(result, 0, sendFrameToVideoInit, "First frame sent to Init Image");
}

export function sendLastFrameToInit(result: VideoResult) {
  return withFrame(result, LAST_FRAME, sendFrameToVideoInit, "Last frame sent to Init Image");
}

export function sendLastFrameToLast(result: VideoResult) {
  return withFrame(result, LAST_FRAME, sendFrameToVideoLast, "Last frame sent to Last Image");
}

export function sendFrameToUpscaleFrom(result: VideoResult) {
  return withFrame(result, 0, sendFrameToUpscale, "Frame sent to Upscale");
}

export function extendFrom(result: VideoResult) {
  return withFrame(
    result,
    LAST_FRAME,
    async (blob) => {
      if (!(await sendFrameToVideoInit(blob))) return false;
      restoreVideoSettings(result.params, result.domain);
      return true;
    },
    "Ready to extend video",
  );
}

export function restoreResultSettings(result: VideoResult) {
  restoreVideoSettings(result.params, result.domain);
  toast.success("Video settings restored");
}

export async function sendCapturedFrameToInit(blob: Blob) {
  if (await sendFrameToVideoInit(blob)) toast.success("Captured frame sent to Init Image");
}

export function downloadResult(result: VideoResult) {
  const stamp = new Date(result.timestamp).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  downloadMedia(result.videoUrl, `enso-${stamp}.${result.format}`).catch(
    failedWith("Could not download the video"),
  );
}
