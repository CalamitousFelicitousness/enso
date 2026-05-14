import type { CloudModel, UnifiedModel } from "@/api/types/cloud";

// Single source of truth for "is this a cloud video model?" - used by
// ModelSelector's video-modality filter and VideoPanel's cloud-branch gate.
// A model qualifies when it's a CloudModel and advertises at least one
// video modality. Per sdnext's adapter.infer_modalities, every video model
// carries "text-to-video"; "image-to-video" is additive for i2v-capable
// models, so either string is a positive match.

export function isCloudVideoModel(m: UnifiedModel | null | undefined): m is CloudModel {
  if (!m || m.source !== "cloud") return false;
  return m.modalities.some((mod) => mod === "text-to-video" || mod === "image-to-video");
}

export function supportsImageToVideo(m: CloudModel): boolean {
  return m.modalities.includes("image-to-video");
}
