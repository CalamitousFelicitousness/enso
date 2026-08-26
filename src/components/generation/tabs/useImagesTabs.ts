import { useUiStore } from "@/stores/uiStore";
import { useModelCapabilities } from "@/hooks/useModelCapabilities";
import { useSubTabs } from "@/components/layout/useSubTabs";
import { IMAGES_TAB_REGISTRY } from "./registry";

/** Images sub-tabs the active model offers, plus the resolved selection. */
export function useImagesTabs() {
  const stored = useUiStore((s) => s.activeImagesSubTab);
  const setImagesSubTab = useUiStore((s) => s.setImagesSubTab);
  const { showTab } = useModelCapabilities();
  const resolved = useSubTabs({
    registry: IMAGES_TAB_REGISTRY,
    isVisible: showTab,
    stored,
    fallback: "prompts",
  });
  return { ...resolved, setActive: setImagesSubTab };
}
