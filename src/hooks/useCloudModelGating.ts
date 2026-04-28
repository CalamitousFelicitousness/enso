import { useModelSelectionStore } from "@/stores/modelSelectionStore";

const CLOUD_VISIBLE_TABS = ["prompts", "guidance", "control"];

export function useCloudModelGating() {
  const isCloud = useModelSelectionStore((s) => s.isCloud);

  return {
    isCloud,
    showTab: (tabId: string) => {
      if (!isCloud) return true;
      return CLOUD_VISIBLE_TABS.includes(tabId);
    },
  };
}
