import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import type { PromptStyleV2, NetworkDetail, ExtraNetworksResponse } from "../types/models";

interface RefreshNetworksResponse {
  ok: boolean;
  total: number;
}

export function useExtraNetworks(
  params: {
    page?: string | undefined;
    search?: string | undefined;
    subfolder?: string | undefined;
    offset?: number | undefined;
    limit?: number | undefined;
  } = {},
) {
  const queryParams: Record<string, string> = {};
  if (params.page) queryParams["page"] = params.page;
  if (params.search) queryParams["search"] = params.search;
  if (params.subfolder) queryParams["subfolder"] = params.subfolder;
  if (params.offset != null) queryParams["offset"] = String(params.offset);
  if (params.limit != null) queryParams["limit"] = String(params.limit);
  return useQuery({
    queryKey: ["extra-networks", params],
    queryFn: () => api.get<ExtraNetworksResponse>("/sdapi/v2/extra-networks", queryParams),
    staleTime: 60_000,
  });
}

export function usePromptStyles() {
  return useQuery({
    queryKey: ["prompt-styles"],
    queryFn: () => api.get<PromptStyleV2[]>("/sdapi/v2/prompt-styles"),
    staleTime: 60_000,
  });
}

export function useNetworkDetail(page: string, name: string, enabled: boolean) {
  return useQuery({
    queryKey: ["network-detail", page, name],
    queryFn: () => api.get<NetworkDetail>("/sdapi/v2/extra-networks/detail", { page, name }),
    enabled,
    staleTime: 60_000,
  });
}

// Pass a page name to rescan just that page; undefined rescans every page,
// which includes a full checkpoint walk.
export function useRefreshNetworks() {
  const queryClient = useQueryClient();
  return useMutation<RefreshNetworksResponse, Error, string | undefined>({
    mutationFn: (page) =>
      api.post<RefreshNetworksResponse>(
        page
          ? `/sdapi/v2/extra-networks/refresh?page=${encodeURIComponent(page)}`
          : "/sdapi/v2/extra-networks/refresh",
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["extra-networks"] });
      void queryClient.invalidateQueries({ queryKey: ["prompt-styles"] });
      // sd_unet and sd_vae dropdown choices are served from options-info.
      void queryClient.invalidateQueries({ queryKey: ["options-info"] });
    },
  });
}
