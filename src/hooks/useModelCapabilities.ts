import { useMemo } from "react";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { useCurrentCheckpoint } from "@/api/hooks/useModels";
import {
  capabilityRecord,
  useModelCapabilityStore,
  type ModelCapabilityRecord,
} from "@/stores/modelCapabilityStore";
import { showImagesTab } from "@/lib/tabVisibility";
import type { ImagesSubTab } from "@/lib/constants";
import type { LocalModel, UnifiedModel } from "@/api/types/cloud";
import type { CheckpointGuidanceV2, CheckpointInfoV2, DetailerMode } from "@/api/types/models";

/**
 * Per-feature capability flags for the active model. Local models support
 * everything sdnext can do; remote (cloud) models report a subset derived
 * from the provider's advertised capabilities + modalities.
 */
export interface ModelSupports {
  detailer: boolean;
  controlNet: boolean;
  /** The model takes input images, so the Input tab applies. */
  inputs: boolean;
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
  /** The request sets the loaded local pipeline's output size, also from a
   * single input image; null while unknown and for other models. */
  requestSetsSize: boolean | null;
  /** How the detailer runs on the loaded local pipeline, "none" when it
   * cannot; null while unknown and for other models. */
  detailerMode: DetailerMode | null;
  /** An image-to-image pass on the loaded local pipeline takes a denoising
   * strength; true while unknown and for other models. */
  strengthSupported: boolean;
  /** Guidance settings the loaded local pipeline applies; null while unknown. */
  guidance: CheckpointGuidanceV2 | null;
  /** Width and height multiple the loaded local pipeline keeps a requested
   * size at; null while unknown. */
  sizeMultiple: number | null;
  /** The loaded local checkpoint carries its control model, so a ControlNet
   * frame needs none; null while unknown and for other models. */
  controlUnified: boolean | null;
}

const LOCAL_SUPPORTS: ModelSupports = {
  detailer: true,
  controlNet: true,
  inputs: true,
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
  inputs: false,
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

/** What the selected model's pipeline reports: the loaded checkpoint when it is
 * the selected model, else what that model reported when it was last loaded.
 * A pick only updates the store, so a different checkpoint may be loaded. */
function knownCapabilities(
  model: LocalModel | null,
  checkpoint: CheckpointInfoV2 | undefined,
  remembered: ModelCapabilityRecord | undefined,
): ModelCapabilityRecord | null {
  if (!model) return null;
  if (checkpoint?.loaded && checkpoint.title === model.title) return capabilityRecord(checkpoint);
  return remembered ?? null;
}

export function useModelCapabilities(): ModelCapabilities {
  const model = useModelSelectionStore((s) => s.activeModel);
  const { data: checkpoint } = useCurrentCheckpoint();
  const remembered = useModelCapabilityStore((s) =>
    model?.source === "local" ? s.byTitle[model.title] : undefined,
  );
  return useMemo(() => {
    if (!model || model.source === "local") {
      const loaded = knownCapabilities(model, checkpoint, remembered);
      return {
        kind: "local",
        model,
        supports: LOCAL_SUPPORTS,
        showTab: (tabId) => showImagesTab(tabId, LOCAL_SUPPORTS),
        maxInputImages: loaded?.max_input_images ?? null,
        requestSetsSize: loaded?.request_sets_size ?? null,
        detailerMode: loaded?.detailer_mode ?? null,
        strengthSupported: loaded?.strength_applicable ?? true,
        guidance: loaded?.guidance ?? null,
        sizeMultiple: loaded?.size_multiple ?? null,
        controlUnified: loaded?.control_unified ?? null,
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
        requestSetsSize: null,
        detailerMode: null,
        strengthSupported: true,
        guidance: null,
        sizeMultiple: null,
        controlUnified: null,
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
      inputs:
        mods.includes("image-to-image") ||
        caps.includes("controlnet") ||
        (model.max_input_images ?? 0) > 0,
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
      requestSetsSize: null,
      detailerMode: null,
      strengthSupported: true,
      guidance: null,
      sizeMultiple: null,
      controlUnified: null,
    };
  }, [model, checkpoint, remembered]);
}
