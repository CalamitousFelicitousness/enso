import { useMemo } from "react";
import { useOptionsSubset } from "@/api/hooks/useSettings";

// Mirrors modules.cloud.registry.resolve_default_provider on the
// frontend. sdnext exposes per-modality default-provider opts via the standard
// /sdapi/v2/options surface; this hook reads them and applies the same
// specific -> coarse -> "" fallback chain.
//
// Used by cloud feature UIs to pre-fill the provider dropdown when the user's
// per-feature slot in cloudTextStore is still empty. Once the user picks a
// provider their choice overrides the default for that feature.

const KEYS = [
  "cloud_default_text_provider",
  "cloud_default_vision_provider",
  "cloud_default_image_provider",
  "cloud_default_video_provider",
  "cloud_default_audio_provider",
  "cloud_default_provider",
];

export type CloudModality = "text" | "vision" | "image" | "video" | "audio";

export interface CloudDefaults {
  text: string;
  vision: string;
  image: string;
  video: string;
  audio: string;
}

export function useCloudDefaults(): CloudDefaults {
  const { data } = useOptionsSubset(KEYS);
  return useMemo(() => {
    const get = (k: string): string => {
      const v = data?.[k];
      return typeof v === "string" ? v : "";
    };
    const coarse = get("cloud_default_provider");
    const resolve = (modality: CloudModality): string =>
      get(`cloud_default_${modality}_provider`) || coarse;
    return {
      text: resolve("text"),
      vision: resolve("vision"),
      image: resolve("image"),
      video: resolve("video"),
      audio: resolve("audio"),
    };
  }, [data]);
}
