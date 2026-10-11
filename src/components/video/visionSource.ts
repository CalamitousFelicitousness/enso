import { getVideoInputs } from "@/lib/video/inputs";
import { videoInputOptions } from "@/lib/video/buildVideoPayload";
import { sendOne, type UploadBatch } from "@/inputs/uploads";

/** Vision image for prompt enhance: the video canvas init frame, sent on the
 * action's batch. */
export async function videoInitVisionSource(batch: UploadBatch): Promise<string | null> {
  const init = getVideoInputs().init;
  return init ? sendOne(batch, init.file, videoInputOptions(init)) : null;
}
