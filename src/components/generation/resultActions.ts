// What the strip's picture actions do, shared by the hover row and the menu.

import { sendResultToCanvas, sendResultToUpscale } from "@/lib/sendTo";
import { downloadMedia, failedWith } from "@/lib/mediaFiles";
import { generateImageFilename } from "@/lib/utils";
import type { GenerationResult } from "@/stores/generationStore";

export function sendToCanvas(result: GenerationResult, imageIndex: number): void {
  sendResultToCanvas(result, imageIndex).catch(
    failedWith("Could not send the image to the canvas"),
  );
}

export function sendToUpscale(result: GenerationResult, imageIndex: number): void {
  sendResultToUpscale(result, imageIndex).catch(failedWith("Could not send the image to Process"));
}

export function download(result: GenerationResult, imageIndex: number): void {
  const filename = generateImageFilename(result.info, imageIndex);
  downloadMedia(result.images[imageIndex], filename).catch(
    failedWith("Could not download the image"),
  );
}
