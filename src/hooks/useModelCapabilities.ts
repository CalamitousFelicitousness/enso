import { useMemo } from "react";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import type { UnifiedModel } from "@/api/types/cloud";

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
  /** Whether the model accepts more than one input image. Drives the Reference
   * filmstrip's multi-slot UI (when false, falls back to single-image
   * Reference). Mirrors CloudModel.multi_image. */
  multiImage: boolean;
}

export interface ModelCapabilities {
  kind: "local" | "local-video" | "cloud";
  model: UnifiedModel | null;
  supports: ModelSupports;
  /** True when the named left-rail sub-tab should be visible for the active model. */
  showTab: (tabId: string) => boolean;
  /** Cap on input image count for the active model. Null when no advertised
   * limit. Filmstrip uses it to disable the AddSlot once at capacity. Lives
   * outside ModelSupports because it's not a boolean. Mirrors
   * CloudModel.max_input_images on the wire (renamed in sdnext c79dd3f23
   * to disambiguate from NanoGPT's output-n cap; see SPEC §11.11.14). */
  maxInputImages: number | null;
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
  // Local checkpoints don't multiplex multi-image through this surface;
  // multi-input ControlNet/IP-Adapter has its own path. The filmstrip
  // stays single-image-fallback for local; ControlTab is the multi-input
  // home for local workflows.
  multiImage: false,
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
  multiImage: false,
};

// Tabs gate on a specific `supports` flag. Tabs that are sdnext-only concepts
// (sampler, refine, detail, advanced, color, scripts) map to flags the cloud
// branch never sets true, so they hide automatically for remote models.
const TAB_TO_FLAG: Record<string, keyof ModelSupports | "always"> = {
  prompts: "always",
  sampler: "sampler",
  guidance: "guidance",
  refine: "refine",
  detail: "detailer",
  advanced: "sampler", // Advanced surfaces sampler-side knobs; gate together.
  color: "sampler", // Color grading is post-process on the local pipeline.
  control: "controlNet",
  scripts: "scripts",
};

export function useModelCapabilities(): ModelCapabilities {
  const model = useModelSelectionStore((s) => s.activeModel);
  return useMemo(() => {
    if (!model || model.source === "local") {
      return {
        kind: "local",
        model,
        supports: LOCAL_SUPPORTS,
        showTab: (tabId: string) => {
          const flag = TAB_TO_FLAG[tabId];
          return flag === undefined || flag === "always" || LOCAL_SUPPORTS[flag];
        },
        maxInputImages: null,
      };
    }
    if (model.source === "local-video") {
      return {
        kind: "local-video",
        model,
        supports: LOCAL_VIDEO_SUPPORTS,
        // Images-view sub-tabs all hide for local-video; "prompts" survives
        // via the "always" flag. Local-video models drive their own panel
        // and never reach the Images-side sub-tab gating in practice.
        showTab: (tabId: string) => TAB_TO_FLAG[tabId] === "always",
        maxInputImages: null,
      };
    }
    const caps = model.capabilities;
    const mods = model.modalities;
    const supports: ModelSupports = {
      // sdnext-only concepts — never true for remote models.
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
      // Multi-image capability surfaced in Phase 2.6. Defaults to false on
      // older sdnext builds that don't advertise the field yet.
      multiImage: model.multi_image ?? false,
    };
    return {
      kind: "cloud",
      model,
      supports,
      showTab: (tabId: string) => {
        const flag = TAB_TO_FLAG[tabId];
        if (flag === undefined || flag === "always") return true;
        return supports[flag];
      },
      maxInputImages: model.max_input_images ?? null,
    };
  }, [model]);
}
