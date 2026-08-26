import type { ImagesSubTab } from "@/lib/constants";
import type { ModelSupports } from "@/hooks/useModelCapabilities";

// Tabs gate on a specific `supports` flag. Tabs that are sdnext-only concepts
// (sampler, refine, detail, advanced, color, scripts) map to flags the cloud
// branch never sets true, so they hide automatically for remote models.
// Exhaustive over ImagesSubTab: an added sub-tab must declare its gate.
const TAB_TO_FLAG: Record<ImagesSubTab, keyof ModelSupports | "always"> = {
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

/** Whether an Images sub-tab is available to a model with these flags. */
export function showImagesTab(tabId: ImagesSubTab, supports: ModelSupports): boolean {
  const flag = TAB_TO_FLAG[tabId];
  return flag === "always" || supports[flag];
}
