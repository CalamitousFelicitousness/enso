import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import type { CloudModel, Provider, ProviderPreset } from "../types/cloud";

export function useCloudProviders() {
  return useQuery({
    queryKey: ["cloud-providers"],
    queryFn: () => api.get<Provider[]>("/sdapi/v2/cloud/providers"),
    staleTime: 60_000,
  });
}

export function useCloudModels(providerId: string) {
  return useQuery({
    queryKey: ["cloud-models", providerId],
    queryFn: async () => {
      const resp = await api.get<{ models: CloudModel[]; total: number }>(
        `/sdapi/v2/cloud/providers/${providerId}/models`,
      );
      return resp.models ?? [];
    },
    staleTime: 300_000,
    enabled: !!providerId,
  });
}

export function useAllCloudModels() {
  const { data: providers } = useCloudProviders();
  const enabledProviders = providers?.filter((p) => p.enabled && p.status === "ok") ?? [];

  return useQuery({
    queryKey: ["cloud-models-all", enabledProviders.map((p) => p.id).join(",")],
    queryFn: async () => {
      const results = await Promise.all(
        enabledProviders.map(async (provider) => {
          try {
            const resp = await api.get<{ models: CloudModel[]; total: number }>(
              `/sdapi/v2/cloud/providers/${provider.id}/models`,
            );
            return { provider, models: resp.models ?? [] };
          } catch {
            return { provider, models: [] };
          }
        }),
      );
      return results.filter((r) => r.models.length > 0);
    },
    staleTime: 300_000,
    enabled: enabledProviders.length > 0,
  });
}

export function useAddProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { name: string; preset: ProviderPreset; base_url: string; key?: string }) =>
      api.post("/sdapi/v2/cloud/providers", params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cloud-providers"] });
    },
  });
}

export function useRemoveProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (providerId: string) =>
      api.delete(`/sdapi/v2/cloud/providers/${providerId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cloud-providers"] });
      void queryClient.invalidateQueries({ queryKey: ["cloud-models-all"] });
    },
  });
}

export function useUpdateProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...updates
    }: {
      id: string;
      name?: string;
      base_url?: string;
      key?: string;
      enabled?: boolean;
    }) => api.put(`/sdapi/v2/cloud/providers/${id}`, updates),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cloud-providers"] });
      void queryClient.invalidateQueries({ queryKey: ["cloud-models-all"] });
    },
  });
}

export function useRefreshProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (providerId: string) =>
      api.post<{ model_count: number }>(`/sdapi/v2/cloud/providers/${providerId}/refresh`),
    onSuccess: (_data, providerId) => {
      void queryClient.invalidateQueries({ queryKey: ["cloud-models", providerId] });
      void queryClient.invalidateQueries({ queryKey: ["cloud-models-all"] });
    },
  });
}

export function useValidateProvider() {
  return useMutation({
    mutationFn: (providerId: string) =>
      api.post<{ valid: boolean; error?: string }>(`/sdapi/v2/cloud/providers/${providerId}/validate`),
  });
}
