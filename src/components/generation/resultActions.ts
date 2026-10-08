// What the strip's picture actions do, shared by the hover row and the menu.

import { toast } from "sonner";
import { sendResultToCanvas, sendResultToUpscale } from "@/lib/sendTo";
import { downloadImage, generateImageFilename } from "@/lib/utils";
import type { GenerationResult } from "@/stores/generationStore";

export function sendToCanvas(result: GenerationResult, imageIndex: number): void {
  sendResultToCanvas(result, imageIndex).catch(() => toast.error("Failed to send to canvas"));
}

export function sendToUpscale(result: GenerationResult, imageIndex: number): void {
  sendResultToUpscale(result, imageIndex).catch(() => toast.error("Failed to send to upscale"));
}

export function download(result: GenerationResult, imageIndex: number): void {
  const filename = generateImageFilename(result.info, imageIndex);
  void downloadImage(result.images[imageIndex], filename);
}
