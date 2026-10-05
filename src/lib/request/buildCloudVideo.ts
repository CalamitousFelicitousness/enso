import { useVideoStore } from "@/stores/videoStore";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { supportsImageToVideo } from "@/lib/cloudVideo";
import { getVideoInputs } from "@/lib/video/inputs";
import { uploadFile } from "@/lib/upload";
import type { CloudModel, CloudVideoJobParams } from "@/api/types/cloud";

export async function buildCloudVideoRequest(): Promise<CloudVideoJobParams> {
  const { activeModel } = useModelSelectionStore.getState();
  const video = useVideoStore.getState();
  // VideoPanel.canGenerate guards entry on isCloudVideoModel(activeModel), so
  // the cast is safe here. If we're called with a non-cloud-video model,
  // payload.provider/model end up empty and the backend rejects with 4xx.
  const model = activeModel as CloudModel;

  const request: CloudVideoJobParams = {
    type: "cloud_video",
    provider: model.provider,
    model: model.id,
    prompt: video.prompt,
  };

  if (video.cloudAspectRatio) request.aspect_ratio = video.cloudAspectRatio;
  if (video.cloudDuration > 0) request.duration = video.cloudDuration;

  const initImage = getVideoInputs().init;
  if (initImage && supportsImageToVideo(model)) {
    request.image = await uploadFile(initImage);
  }

  return request;
}
