import { useState } from "react";
import { Combine, Replace, Scissors, CloudDownload, Globe } from "lucide-react";
import { useLoadedModels } from "@/api/hooks/useServer";
import { useRegisterCommand } from "@/lib/commandRegistry";
import { cn } from "@/lib/utils";

import { CurrentSubTab } from "@/components/models/sub-tabs/CurrentSubTab";
import { ListSubTab } from "@/components/models/sub-tabs/ListSubTab";
import { MetadataSubTab } from "@/components/models/sub-tabs/MetadataSubTab";
import { LoaderSubTab } from "@/components/models/sub-tabs/LoaderSubTab";
import { MergeSubTab } from "@/components/models/sub-tabs/MergeSubTab";
import { ReplaceSubTab } from "@/components/models/sub-tabs/ReplaceSubTab";
import { CivitaiSubTab } from "@/components/models/sub-tabs/CivitaiSubTab";
import { HuggingfaceSubTab } from "@/components/models/sub-tabs/HuggingfaceSubTab";
import { ExtractLoraSubTab } from "@/components/models/sub-tabs/ExtractLoraSubTab";

const SUB_TABS = [
  "Current",
  "List",
  "Metadata",
  "Loader",
  "Merge",
  "Replace",
  "CivitAI",
  "Huggingface",
  "Extract LoRA",
] as const;

type SubTab = (typeof SUB_TABS)[number];

export function ModelsTab() {
  const [active, setActive] = useState<SubTab>("Current");
  const { data: loaded } = useLoadedModels();
  const loadedCount = loaded?.length ?? 0;

  useRegisterCommand({
    id: "models:open-merge",
    label: "Open Model Merge",
    group: "Models",
    keywords: ["merge", "combine", "blend", "checkpoint"],
    icon: Combine,
    run: () => setActive("Merge"),
  });
  useRegisterCommand({
    id: "models:open-replace",
    label: "Open Model Replace",
    group: "Models",
    keywords: ["replace", "swap", "substitute", "checkpoint"],
    icon: Replace,
    run: () => setActive("Replace"),
  });
  useRegisterCommand({
    id: "models:open-extract-lora",
    label: "Open LoRA Extract",
    group: "Models",
    keywords: ["lora", "extract", "distill", "low rank"],
    icon: Scissors,
    run: () => setActive("Extract LoRA"),
  });
  useRegisterCommand({
    id: "models:open-civitai",
    label: "Browse CivitAI models",
    group: "Models",
    keywords: ["civitai", "download", "browse", "search"],
    icon: CloudDownload,
    run: () => setActive("CivitAI"),
  });
  useRegisterCommand({
    id: "models:open-huggingface",
    label: "Browse Hugging Face models",
    group: "Models",
    keywords: ["huggingface", "hf", "download", "browse"],
    icon: Globe,
    run: () => setActive("Huggingface"),
  });

  return (
    <div>
      <div className="sticky top-0 z-10 bg-card p-2 space-y-2 border-b border-border">
        <p className="text-2xs text-muted-foreground">
          {loadedCount} model{loadedCount !== 1 ? "s" : ""} loaded
        </p>
        <div className="flex items-center gap-1 flex-wrap">
          {SUB_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActive(tab)}
              className={cn(
                "px-2 py-0.5 rounded-md text-2xs font-medium transition-colors",
                active === tab
                  ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>
      <div className="p-3">
        {active === "Current" && <CurrentSubTab />}
        {active === "List" && <ListSubTab />}
        {active === "Metadata" && <MetadataSubTab />}
        {active === "Loader" && <LoaderSubTab />}
        {active === "Merge" && <MergeSubTab />}
        {active === "Replace" && <ReplaceSubTab />}
        {active === "CivitAI" && <CivitaiSubTab />}
        {active === "Huggingface" && <HuggingfaceSubTab />}
        {active === "Extract LoRA" && <ExtractLoraSubTab />}
      </div>
    </div>
  );
}
