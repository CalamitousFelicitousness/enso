import { useQuery } from "@tanstack/react-query";
import { api } from "../client";
import type { ResMemory, ResGPU, ServerInfo, LoadedModel } from "../types/server";
import { SERVER_INFO_KEY } from "../queryKeys";

/** What the server runs and offers; the hook and the submit path share the cache entry. */
export const serverInfoQuery = {
  queryKey: SERVER_INFO_KEY,
  queryFn: () => api.get<ServerInfo>("/sdapi/v2/server-info"),
  staleTime: 30_000,
};

export function useServerInfo() {
  return useQuery({ ...serverInfoQuery, retry: 2 });
}

export function useMemory(enabled = true) {
  return useQuery({
    queryKey: ["memory"],
    queryFn: () => api.get<ResMemory>("/sdapi/v2/memory"),
    enabled,
    refetchInterval: enabled ? 5000 : false,
    staleTime: 5000,
  });
}

export function useGpuStatus(enabled = true) {
  return useQuery({
    queryKey: ["gpu"],
    queryFn: () => api.get<ResGPU[]>("/sdapi/v2/gpu"),
    enabled,
    refetchInterval: enabled ? 3000 : false,
    staleTime: 3000,
  });
}

export function useCapabilities() {
  const { data } = useServerInfo();
  return data?.capabilities ?? null;
}

export function useLoadedModels(enabled = true) {
  return useQuery({
    queryKey: ["loaded-models"],
    queryFn: () => api.get<LoadedModel[]>("/sdapi/v2/loaded-models"),
    enabled,
    refetchInterval: enabled ? 10_000 : false,
    staleTime: 5_000,
  });
}
