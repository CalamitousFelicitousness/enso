import { getVideoInputs } from "@/lib/video/inputs";
import { uploadBlob } from "@/lib/upload";

/** Vision image for prompt enhance: the video canvas init frame. */
export async function videoInitVisionSource(): Promise<string | null> {
  const initImg = getVideoInputs().init;
  return initImg ? await uploadBlob(initImg, "vision.png") : null;
}
