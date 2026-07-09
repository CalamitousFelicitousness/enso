import { useState, useCallback } from "react";
import {
  useCivitOptions,
  useCivitSearchInfinite,
  useCivitSettings,
  useCivitMe,
} from "@/api/hooks/useCivitai";
import type { CivitHistoryEntry, CivitSearchParams } from "@/api/types/civitai";
import { useUiStore } from "@/stores/uiStore";
import { CivitSettings } from "./civitai/CivitSettings";
import { CivitSearchBar } from "./civitai/CivitSearchBar";
import { CivitFilters } from "./civitai/CivitFilters";
import { CivitResultList } from "./civitai/CivitResultList";
import { CivitModelDetail } from "./civitai/CivitModelDetail";
import { CivitDownloadQueue } from "./civitai/CivitDownloadQueue";

export function CivitaiSubTab() {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState("");
  const [period, setPeriod] = useState("");
  const [baseModel, setBaseModel] = useState("");
  const [creator, setCreator] = useState("");
  const nsfw = useUiStore((s) => s.civitaiNsfw);
  const favorites = useUiStore((s) => s.civitaiFavorites);
  const setNsfw = useUiStore((s) => s.setCivitaiNsfw);
  const setFavorites = useUiStore((s) => s.setCivitaiFavorites);
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);

  const { data: options } = useCivitOptions();
  const { data: settings } = useCivitSettings();
  const tokenConfigured = settings?.token_configured ?? false;
  const { data: me } = useCivitMe(tokenConfigured && favorites);

  const searchParams: CivitSearchParams = {
    query: query || undefined,
    tag: tag || undefined,
    types: type || undefined,
    sort: sort || undefined,
    period: period || undefined,
    base_models: baseModel || undefined,
    nsfw: nsfw || undefined,
    username: favorites && me?.username ? me.username : creator || undefined,
    favorites: favorites || undefined,
    limit: 20,
  };

  const infiniteSearch = useCivitSearchInfinite(searchParams, searchEnabled);

  const handleSearch = useCallback(() => {
    if (searchEnabled) {
      void infiniteSearch.refetch();
    } else {
      setSearchEnabled(true);
    }
  }, [searchEnabled, infiniteSearch]);

  function handleHistorySelect(e: CivitHistoryEntry) {
    setQuery(e.type === "query" ? e.term : "");
    setTag(e.type === "tag" ? e.term : "");
    const p = e.params;
    setType(p?.types ?? "");
    setSort(p?.sort ?? "");
    setPeriod(p?.period ?? "");
    setBaseModel(p?.base_models ?? "");
    setNsfw(p?.nsfw ?? false);
    const fav = p?.favorites ?? false;
    setFavorites(fav);
    // With favorites on, the recorded username is the account's own name,
    // not a creator filter the user typed.
    setCreator(fav ? "" : (p?.username ?? ""));
    setSearchEnabled(true);
  }

  function handleFavoritesChange(v: boolean) {
    setFavorites(v);
    if (v) {
      setSearchEnabled(true);
    }
  }

  const handleSearchCreator = useCallback(
    (creatorName: string) => {
      // favorites overrides username, and free-text would narrow the results, so
      // clear both to show everything by this creator.
      setCreator(creatorName);
      setQuery("");
      setTag("");
      setFavorites(false);
      setSearchEnabled(true);
    },
    [setFavorites],
  );

  return (
    <div className="space-y-3">
      <CivitSettings />
      <CivitSearchBar
        query={query}
        tag={tag}
        onQueryChange={(v) => {
          setQuery(v);
          setSearchEnabled(false);
        }}
        onTagChange={(v) => {
          setTag(v);
          setSearchEnabled(false);
        }}
        onSearch={handleSearch}
        onHistorySelect={handleHistorySelect}
        isLoading={infiniteSearch.isFetching}
      />

      <CivitFilters
        options={options}
        type={type}
        sort={sort}
        period={period}
        baseModel={baseModel}
        creator={creator}
        nsfw={nsfw}
        favorites={favorites}
        tokenConfigured={tokenConfigured}
        onTypeChange={setType}
        onSortChange={setSort}
        onPeriodChange={setPeriod}
        onBaseModelChange={setBaseModel}
        onCreatorChange={setCreator}
        onNsfwChange={setNsfw}
        onFavoritesChange={handleFavoritesChange}
      />

      <CivitDownloadQueue />

      <CivitResultList
        pages={infiniteSearch.data}
        hasNextPage={!!infiniteSearch.hasNextPage}
        isFetchingNextPage={infiniteSearch.isFetchingNextPage}
        fetchNextPage={() => void infiniteSearch.fetchNextPage()}
        onSelectModel={setSelectedModelId}
        onSearchCreator={handleSearchCreator}
      />

      <CivitModelDetail
        modelId={selectedModelId}
        onClose={() => setSelectedModelId(null)}
        onSearchCreator={handleSearchCreator}
      />
    </div>
  );
}
