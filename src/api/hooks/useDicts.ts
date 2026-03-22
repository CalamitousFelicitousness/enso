import { useQuery, useQueries } from "@tanstack/react-query";
import { api } from "../client";
import type { DictInfo, DictContent, DictTag } from "../types/dict";
import { getCachedDict, setCachedDict } from "@/lib/dictCache";

/** List available tag dictionaries. */
export function useDictList() {
  return useQuery({
    queryKey: ["dicts"],
    queryFn: () => api.get<DictInfo[]>("/sdapi/v1/dicts"),
    staleTime: 60_000,
  });
}

/** Fetch a single dict's tags — IDB cache first, API fallback. */
export function useDictTags(name: string | null) {
  return useQuery({
    queryKey: ["dict-tags", name],
    queryFn: async (): Promise<DictTag[]> => {
      if (!name) return [];
      // Check IDB cache first
      const cached = await getCachedDict(name);
      if (cached) return cached;
      // Fetch from backend
      const content = await api.get<DictContent>(`/sdapi/v1/dicts/${name}`);
      const tags: DictTag[] = content.tags.map(([n, cat, count]) => ({
        name: n,
        category: cat,
        count,
      }));
      // Sort alphabetically for binary search in CompletionSource
      tags.sort((a, b) => a.name.localeCompare(b.name));
      // Cache for next session
      await setCachedDict(name, tags, content.version);
      return tags;
    },
    staleTime: 60 * 60 * 1000, // 1 hour
    gcTime: 24 * 60 * 60 * 1000, // 24 hours
    enabled: !!name,
  });
}

/** Fetch multiple dicts in parallel. Returns an array of DictTag arrays. */
export function useDictTagsMulti(names: string[]) {
  const results = useQueries({
    queries: names.map((name) => ({
      queryKey: ["dict-tags", name],
      queryFn: async (): Promise<DictTag[]> => {
        const cached = await getCachedDict(name);
        if (cached) return cached;
        const content = await api.get<DictContent>(`/sdapi/v1/dicts/${name}`);
        const tags: DictTag[] = content.tags.map(([n, cat, count]) => ({
          name: n,
          category: cat,
          count,
        }));
        tags.sort((a, b) => a.name.localeCompare(b.name));
        await setCachedDict(name, tags, content.version);
        return tags;
      },
      staleTime: 60 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
    })),
  });
  return results;
}
