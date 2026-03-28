import { useState, useMemo, useRef } from "react";
import {
  useExtraNetworks,
  usePromptStyles,
  useRefreshNetworks,
} from "@/api/hooks/useNetworks";
import { useCivitMetadataScan } from "@/api/hooks/useCivitai";
import { useOptions, useSetOptions } from "@/api/hooks/useSettings";
import { useLoadModel } from "@/api/hooks/useModels";
import { useGenerationStore } from "@/stores/generationStore";
import { insertAtCursor } from "@/lib/promptCursor";
import type { ExtraNetworkV2 } from "@/api/types/models";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { SegmentOption } from "@/components/ui/segmented-control";
import { NetworkDetailDialog } from "./NetworkDetailDialog";
import { toast } from "sonner";

import { TYPE_FILTERS, type TypeFilter, type SortMode, type NetworkItem } from "./networks/types";
import { PAGE_MAP } from "./networks/constants";
import { isExtraNetwork, isReferenceName } from "./networks/utils";
import { useNetworkFiltering } from "./networks/useNetworkFiltering";
import { useProgressiveRender } from "./networks/useProgressiveRender";
import { useActiveLoraManager } from "./networks/useActiveLoraManager";
import { MatteCard } from "./networks/MatteCard";
import { ActiveLoraStack } from "./networks/ActiveLoraStack";
import { CommandBar } from "./networks/CommandBar";
import { FilterPanel } from "./networks/FilterPanel";
import { NetworkGrid } from "./networks/NetworkGrid";

const TYPE_FILTER_OPTIONS: SegmentOption<TypeFilter>[] = TYPE_FILTERS.map(
  (t) => ({ value: t, label: t }),
);

export function NetworksTab() {
  const { data: options } = useOptions();
  const setOptions = useSetOptions();
  const loadModel = useLoadModel();
  const { data: styles } = usePromptStyles();
  const prompt = useGenerationStore((s) => s.prompt);
  const refreshNetworks = useRefreshNetworks();
  const civitScan = useCivitMetadataScan();

  const [filter, setFilter] = useState<TypeFilter>("Model");
  const [search, setSearch] = useState("");
  const [selectedSubfolder, setSelectedSubfolder] = useState("All");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [filterOpen, setFilterOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<NetworkItem | null>(null);

  const loraManager = useActiveLoraManager();
  const panelRef = useRef<HTMLDivElement>(null);
  const canScan = filter !== "Style" && filter !== "Wildcards";

  // Fetch networks
  const page = PAGE_MAP[filter];
  const { data: networksResp, isLoading } = useExtraNetworks({
    page: page ?? undefined,
    search: search || undefined,
    limit: 500,
  });

  // Merge networks + styles into unified list
  const filtered = useMemo(() => {
    const items: NetworkItem[] = [];
    if (filter === "Style") {
      const lowerSearch = search.toLowerCase();
      for (const s of styles ?? []) {
        if (lowerSearch && !s.name.toLowerCase().includes(lowerSearch))
          continue;
        items.push(s);
      }
    } else {
      for (const n of networksResp?.items ?? []) {
        items.push(n);
      }
    }
    return items;
  }, [networksResp?.items, styles, filter, search]);

  // Filtering + sorting
  const { sidebarGroups, folderTree, classFolders, displayItems } = useNetworkFiltering(
    filtered,
    filter,
    selectedSubfolder,
    sortMode,
  );

  // Progressive rendering
  const { visibleItems, sentinelRef, hasMore } =
    useProgressiveRender(displayItems);

  // LoRA preview map for ActiveLoraStack thumbnails
  const loraPreviewMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const item of networksResp?.items ?? []) {
      const t = item.type?.toLowerCase() ?? "";
      if (t === "lora" || t === "lycoris") {
        map.set(item.name, item.preview ?? null);
      }
    }
    return map;
  }, [networksResp?.items]);

  // Active filter count for badge
  const activeFilterCount =
    selectedSubfolder !== "All" ? 1 : 0;

  // Is item active (checkbox/model loaded/lora in prompt)
  function isActive(item: NetworkItem): boolean {
    if (!isExtraNetwork(item)) {
      const style = item;
      return !!style.prompt && prompt.includes(style.prompt);
    }
    const t = item.type?.toLowerCase() ?? "";
    if (t === "model" || t === "checkpoint")
      return (item.title ?? item.name) === (options?.sd_model_checkpoint as string);
    if (t === "lora" || t === "lycoris")
      return prompt.includes(`<lora:${item.name}:`);
    if (t === "embedding" || t === "textual inversion")
      return prompt.includes(item.name);
    if (t === "wildcards") return prompt.includes(`__${item.name}__`);
    if (t === "vae")
      return (item.title ?? item.name) === (options?.sd_vae as string);
    return false;
  }

  function isActiveLora(item: NetworkItem): boolean {
    if (!isExtraNetwork(item)) return false;
    const t = item.type?.toLowerCase() ?? "";
    if (t !== "lora" && t !== "lycoris") return false;
    return loraManager.activeLoras.some((l) => l.name === item.name);
  }

  function handleFilterChange(t: TypeFilter) {
    setFilter(t);
    setSelectedSubfolder("All");
    setSearch("");
  }

  function handleClick(item: NetworkItem) {
    if (isExtraNetwork(item)) {
      const network = item as ExtraNetworkV2;
      const t = network.type.toLowerCase();
      if (t === "lora" || t === "lycoris") {
        loraManager.toggleLora(network.name);
      } else if (t === "model" || t === "checkpoint") {
        if (isReferenceName(network.name) && network.filename) {
          loadModel.mutate(network.filename);
        } else {
          setOptions.mutate({
            sd_model_checkpoint: network.title ?? network.name,
          });
        }
      } else if (t === "embedding" || t === "textual inversion") {
        const current = useGenerationStore.getState().prompt;
        useGenerationStore
          .getState()
          .setParam("prompt", insertAtCursor(current, network.name));
      } else if (t === "wildcards") {
        const current = useGenerationStore.getState().prompt;
        useGenerationStore
          .getState()
          .setParam("prompt", insertAtCursor(current, `__${network.name}__`));
      } else if (t === "vae") {
        setOptions.mutate({ sd_vae: network.title ?? network.name });
      }
    } else {
      const style = item;
      if (style.prompt) {
        const current = useGenerationStore.getState().prompt;
        useGenerationStore
          .getState()
          .setParam(
            "prompt",
            current ? `${current} ${style.prompt}` : style.prompt,
          );
      }
      if (style.negative_prompt) {
        const currentNeg = useGenerationStore.getState().negativePrompt;
        useGenerationStore
          .getState()
          .setParam(
            "negativePrompt",
            currentNeg
              ? `${currentNeg} ${style.negative_prompt}`
              : style.negative_prompt,
          );
      }
    }
  }

  async function handleCivitScan() {
    const scanPage = PAGE_MAP[filter] ?? undefined;
    try {
      const data = await civitScan.mutateAsync(scanPage);
      const results = data.results ?? [];
      const found = results.filter((r) => String(r.code) === "200").length;
      const notFound = results.filter((r) => String(r.code) === "404").length;
      if (results.length === 0) {
        toast.info("CivitAI scan complete", {
          description: "No items needed scanning",
        });
      } else {
        toast.success("CivitAI scan complete", {
          description: `${found} found, ${notFound} not on CivitAI`,
        });
      }
      refreshNetworks.mutate();
    } catch (err) {
      toast.error("CivitAI scan failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div ref={panelRef} className="flex flex-col h-full">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-card p-3 space-y-2.5 border-b border-border/50 shrink-0">
        <SegmentedControl
          variant="neon-wire"
          animated
          options={TYPE_FILTER_OPTIONS}
          value={filter}
          onValueChange={handleFilterChange}
          className="w-full"
        />
        <CommandBar
          search={search}
          onSearchChange={setSearch}
          filterOpen={filterOpen}
          onFilterToggle={() => setFilterOpen((v) => !v)}
          activeFilterCount={activeFilterCount}
          sort={sortMode}
          onSortChange={setSortMode}
          canScan={canScan}
          isScanPending={civitScan.isPending}
          isRefreshPending={refreshNetworks.isPending}
          onCivitScan={handleCivitScan}
          onRefresh={() => refreshNetworks.mutate()}
        />
        <ActiveLoraStack
          activeLoras={loraManager.activeLoras}
          loraPreviewMap={loraPreviewMap}
          onRemove={loraManager.removeLora}
          onWeightChange={loraManager.setLoraWeight}
        />
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-3 space-y-2">
          {isLoading && (
            <p className="text-xs text-muted-foreground p-2">
              Loading networks...
            </p>
          )}
          <NetworkGrid>
            {visibleItems.map((item) => (
              <MatteCard
                key={
                  isExtraNetwork(item)
                    ? `${item.type}-${item.name}`
                    : item.name
                }
                item={item}
                active={isActive(item)}
                isActiveLora={isActiveLora(item)}
                onClick={() => handleClick(item)}
                onInfo={() => setDetailItem(item)}
              />
            ))}
          </NetworkGrid>
          {hasMore && <div ref={sentinelRef} className="h-8" />}
          {!isLoading && displayItems.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">
              No results found.
            </p>
          )}
        </div>
      </div>

      {/* Filter panel — portaled to body, anchored to left edge of this container */}
      <FilterPanel
        open={filterOpen}
        sidebarGroups={sidebarGroups}
        folderTree={folderTree}
        classFolders={classFolders}
        selectedSubfolder={selectedSubfolder}
        onSubfolderSelect={setSelectedSubfolder}
        anchorRef={panelRef}
      />

      <NetworkDetailDialog
        item={detailItem}
        open={detailItem !== null}
        onOpenChange={(open) => {
          if (!open) setDetailItem(null);
        }}
      />
    </div>
  );
}
