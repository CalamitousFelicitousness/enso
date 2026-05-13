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
}

export interface ModelCapabilities {
  kind: "local" | "cloud";
  model: UnifiedModel | null;
  supports: ModelSupports;
  /** True when the named left-rail sub-tab should be visible for the active model. */
  showTab: (tabId: string) => boolean;
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
      showTab: (tabId: string) => {
        const flag = TAB_TO_FLAG[tabId];
        if (flag === undefined || flag === "always") return true;
        return supports[flag];
      },
    };
  }, [model]);
}
