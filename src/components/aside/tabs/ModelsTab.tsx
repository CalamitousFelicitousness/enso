import { useCallback } from "react";
import { useLoadedModels } from "@/api/hooks/useServer";
import { MODELS_SUB_TABS, type ModelsSubTab } from "@/lib/constants";
import { useUiStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";
import { KeepAliveSwitch, useKeepAliveVisible } from "@/components/ui/keep-alive";
import { buildPanels } from "@/components/ui/tab-panels";

import { CurrentSubTab } from "@/components/models/sub-tabs/CurrentSubTab";
import { ListSubTab } from "@/components/models/sub-tabs/ListSubTab";
import { MetadataSubTab } from "@/components/models/sub-tabs/MetadataSubTab";
import { LoaderSubTab } from "@/components/models/sub-tabs/LoaderSubTab";
import { MergeSubTab } from "@/components/models/sub-tabs/MergeSubTab";
import { ReplaceSubTab } from "@/components/models/sub-tabs/ReplaceSubTab";
import { AuditSubTab } from "@/components/models/sub-tabs/AuditSubTab";
import { CivitaiSubTab } from "@/components/models/sub-tabs/CivitaiSubTab";
import { HuggingfaceSubTab } from "@/components/models/sub-tabs/HuggingfaceSubTab";
import { ExtractLoraSubTab } from "@/components/models/sub-tabs/ExtractLoraSubTab";

const SUB_PANELS = buildPanels([
  { id: "models-Current", content: <CurrentSubTab /> },
  { id: "models-List", content: <ListSubTab /> },
  { id: "models-Audit", content: <AuditSubTab /> },
  { id: "models-Metadata", content: <MetadataSubTab /> },
  { id: "models-Loader", content: <LoaderSubTab /> },
  { id: "models-Merge", content: <MergeSubTab /> },
  { id: "models-Replace", content: <ReplaceSubTab /> },
  { id: "models-CivitAI", content: <CivitaiSubTab /> },
  { id: "models-Huggingface", content: <HuggingfaceSubTab /> },
  { id: "models-Extract LoRA", content: <ExtractLoraSubTab /> },
]);

export function ModelsTab() {
  const active = useUiStore((s) => s.panelSelections.modelsSubTab);
  const setPanelSelection = useUiStore((s) => s.setPanelSelection);
  const setActive = useCallback(
    (tab: ModelsSubTab) => setPanelSelection("modelsSubTab", tab),
    [setPanelSelection],
  );
  const visible = useKeepAliveVisible();
  const { data: loaded } = useLoadedModels(visible);
  const loadedCount = loaded?.length ?? 0;

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="bg-card p-2 space-y-2 border-b border-border shrink-0">
        <p className="text-2xs text-muted-foreground">
          {loadedCount} model{loadedCount !== 1 ? "s" : ""} loaded
        </p>
        <div className="flex items-center gap-1 flex-wrap">
          {MODELS_SUB_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={active === tab.id}
              onClick={() => setActive(tab.id)}
              className={cn(
                "px-2 py-0.5 rounded-md text-2xs font-medium transition-colors",
                active === tab.id
                  ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <KeepAliveSwitch active={`models-${active}`}>{SUB_PANELS}</KeepAliveSwitch>
    </div>
  );
}
