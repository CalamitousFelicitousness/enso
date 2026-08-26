import { VIDEO_SUB_TABS, type VideoSubTab } from "@/lib/constants";
import type { VideoModelCaps } from "@/api/types/video";
import type { VideoJobType } from "@/lib/video/paramRegistry";
import type { VideoUiKind } from "@/lib/videoModel";

// Structural visibility only: "can this tab ever hold content for this
// model". Sections keep their own wire-presence gates for the per-control
// granularity a tab predicate cannot see.

function showVideoSubTab(
  id: VideoSubTab,
  kind: VideoUiKind,
  caps: VideoModelCaps,
  job: VideoJobType | null,
): boolean {
  // Prompts stays reachable with no model so a sent prompt has somewhere to land.
  if (kind === "empty") return id === "prompts";
  if (kind === "cloud") return id === "prompts" || id === "cloud";
  switch (id) {
    case "prompts":
    case "sampling":
    case "output":
      return true;
    case "cloud":
      return false;
    case "inputs":
      return (
        caps.init_image !== "ignored" || caps.last_image !== "ignored" || caps.references.supported
      );
    case "framepack":
      return job === "framepack";
  }
}

/** Visible sub-tabs in registry order, so the rail strip never reorders. */
export function visibleVideoSubTabs(
  kind: VideoUiKind,
  caps: VideoModelCaps,
  job: VideoJobType | null,
): VideoSubTab[] {
  return VIDEO_SUB_TABS.map((t) => t.id).filter((id) => showVideoSubTab(id, kind, caps, job));
}

/** Clamp a stored selection to what this model offers. Never written back:
 * switching away from a model and back restores the user's tab. */
export function resolveVideoSubTab(
  stored: VideoSubTab | undefined,
  visible: readonly VideoSubTab[],
): VideoSubTab {
  if (stored !== undefined && visible.includes(stored)) return stored;
  return visible[0] ?? "prompts";
}
