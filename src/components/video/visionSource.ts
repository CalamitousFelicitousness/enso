import { getVideoInputs } from "@/lib/video/inputs";
import { videoInputOptions } from "@/lib/video/buildVideoPayload";
import { captionPicture } from "@/inputs/fit";
import { sendOne, type UploadBatch } from "@/inputs/uploads";

/** Vision image for prompt enhance: the video canvas init frame, at the size
 * the captioner reads it, sent on the action's batch. */
export async function videoInitVisionSource(batch: UploadBatch): Promise<string | null> {
  const init = getVideoInputs().init;
  if (!init) return null;
  const sized = await captionPicture(init.file, init.file.name);
  if (sized.blob === init.file) return sendOne(batch, init.file, videoInputOptions(init));
  return sendOne(batch, sized.blob, { name: sized.name });
}
