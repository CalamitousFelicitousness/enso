import { useCallback, useMemo } from "react";
import { useUiStore } from "@/stores/uiStore";
import { useActiveVideoCapsResolved } from "@/hooks/useActiveVideoCaps";
import { useSubTabs } from "@/components/layout/useSubTabs";
import { visibleVideoSubTabs } from "@/lib/video/subTabs";
import type { VideoSubTab } from "@/lib/constants";
import { VIDEO_TAB_REGISTRY } from "./registry";
import { useVideoTabContext } from "./useVideoTabContext";

/** Video sub-tabs the active model offers, plus the resolved selection. */
export function useVideoTabs() {
  const stored = useUiStore((s) => s.panelSelections.videoSubTab);
  const setPanelSelection = useUiStore((s) => s.setPanelSelection);
  const { kind, job, caps } = useVideoTabContext();
  const capsResolved = useActiveVideoCapsResolved();

  const isVisible = useMemo(() => {
    const shown = new Set(visibleVideoSubTabs(kind, caps, job));
    // Until real caps arrive the set is fallback-derived, so keep the stored
    // tab reachable rather than clamping to prompts and bouncing back.
    if (!capsResolved) shown.add(stored);
    return (id: VideoSubTab) => shown.has(id);
  }, [kind, caps, job, capsResolved, stored]);

  const resolved = useSubTabs({
    registry: VIDEO_TAB_REGISTRY,
    isVisible,
    stored,
    fallback: "prompts",
  });

  const setActive = useCallback(
    (tab: VideoSubTab) => setPanelSelection("videoSubTab", tab),
    [setPanelSelection],
  );

  return { ...resolved, setActive, kind, job };
}
