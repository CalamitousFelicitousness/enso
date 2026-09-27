import { useMemo } from "react";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { useCurrentCheckpoint } from "@/api/hooks/useModels";
import { showImagesTab } from "@/lib/tabVisibility";
import type { ImagesSubTab } from "@/lib/constants";
import type { LocalModel, UnifiedModel } from "@/api/types/cloud";
import type { CheckpointGuidanceV2, CheckpointInfoV2 } from "@/api/types/models";

/**
 * Per-feature capability flags for the active model. Local models support
 * everything sdnext can do; remote (cloud) models report a subset derived
 * from the provider's advertised capabilities + modalities.
 */
export interface ModelSupports {
  detailer: boolean;
  controlNet: boolean;
  img2img: boolean;
  inpaint: boolean;
  negativePrompt: boolean;
  seed: boolean;
  guidance: boolean;
  style: boolean;
  quality: boolean;
  sampler: boolean;
  refine: boolean;
  scripts: boolean;
}

export interface ModelCapabilities {
  kind: "local" | "local-video" | "cloud";
  model: UnifiedModel | null;
  supports: ModelSupports;
  /** True when the named left-rail sub-tab should be visible for the active model. */
  showTab: (tabId: ImagesSubTab) => boolean;
  /** Most input images the active model takes in one request; null while
   * unknown or when the model advertises no limit. Local models report it on
   * /sdapi/v2/checkpoint once loaded; cloud models as max_input_images. */
  maxInputImages: number | null;
  /** Guidance settings the loaded local pipeline applies; null while unknown. */
  guidance: CheckpointGuidanceV2 | null;
  /** Width and height multiple the loaded local pipeline keeps a requested
   * size at; null while unknown. */
  sizeMultiple: number | null;
}

const LOCAL_SUPPORTS: ModelSupports = {
  detailer: true,
  controlNet: true,
  img2img: true,
  inpaint: true,
  negativePrompt: true,
  seed: true,
  guidance: true,
  style: true,
  quality: true,
  sampler: true,
  refine: true,
  scripts: true,
};

// Local video models live in the Video view's own panel and don't touch any
// of the Images-view sub-tabs. All flags false so the Images-side `showTab`
// drops every gated tab, leaving only "prompts" (gated by "always").
const LOCAL_VIDEO_SUPPORTS: ModelSupports = {
  detailer: false,
  controlNet: false,
  img2img: false,
  inpaint: false,
  negativePrompt: false,
  seed: false,
  guidance: false,
  style: false,
  quality: false,
  sampler: false,
  refine: false,
  scripts: false,
};

/** The loaded checkpoint when it is the selected model. Selecting only updates
 * the store, so a different checkpoint may still be loaded. */
function loadedCheckpoint(
  model: LocalModel | null,
  checkpoint: CheckpointInfoV2 | undefined,
): CheckpointInfoV2 | null {
  if (!model || !checkpoint?.loaded || checkpoint.title !== model.title) return null;
  return checkpoint;
}

export function useModelCapabilities(): ModelCapabilities {
  const model = useModelSelectionStore((s) => s.activeModel);
  const { data: checkpoint } = useCurrentCheckpoint();
  return useMemo(() => {
    if (!model || model.source === "local") {
      const loaded = loadedCheckpoint(model, checkpoint);
      return {
        kind: "local",
        model,
        supports: LOCAL_SUPPORTS,
        showTab: (tabId) => showImagesTab(tabId, LOCAL_SUPPORTS),
        maxInputImages: loaded?.max_input_images ?? null,
        guidance: loaded?.guidance ?? null,
        sizeMultiple: loaded?.size_multiple ?? null,
      };
    }
    if (model.source === "local-video") {
      return {
        kind: "local-video",
        model,
        supports: LOCAL_VIDEO_SUPPORTS,
        // Every gated tab drops out against the all-false table; "prompts"
        // survives via its "always" gate.
        showTab: (tabId) => showImagesTab(tabId, LOCAL_VIDEO_SUPPORTS),
        maxInputImages: null,
        guidance: null,
        sizeMultiple: null,
      };
    }
    const caps = model.capabilities;
    const mods = model.modalities;
    const supports: ModelSupports = {
      // sdnext-only concepts - never true for remote models.
      detailer: false,
      sampler: false,
      refine: false,
      scripts: false,
      // Provider-advertised capabilities.
      controlNet: caps.includes("controlnet"),
      negativePrompt: caps.includes("negative-prompt"),
      seed: caps.includes("seed"),
      guidance: caps.includes("guidance"),
      style: caps.includes("style"),
      quality: caps.includes("quality"),
      // Provider-advertised modalities.
      img2img: mods.includes("image-to-image"),
      inpaint: mods.includes("inpaint"),
    };
    return {
      kind: "cloud",
      model,
      supports,
      showTab: (tabId) => showImagesTab(tabId, supports),
      maxInputImages: model.max_input_images ?? null,
      guidance: null,
      sizeMultiple: null,
    };
  }, [model, checkpoint]);
}
