import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import type { VideoCodec, VideoEngine, VideoLoadResponse, VideoModelCaps } from "../types/video";
import type { LocalVideoModel } from "../types/cloud";
import { engineToKind, jobTypeToKind } from "@/lib/videoModel";
import { capsKey } from "@/lib/video/caps";
import { loadsModel, type LoadsModel } from "@/lib/jobs/requests";

export function useVideoEngines(enabled = true) {
  return useQuery({
    queryKey: ["video-engines"],
    queryFn: () => api.get<VideoEngine[]>("/sdapi/v2/video/engines"),
    staleTime: 300_000,
    enabled,
  });
}

/** The video model the server has loaded, by name; null for none. */
export function loadedVideoModel(engines: VideoEngine[] | undefined): string | null {
  for (const engine of engines ?? []) {
    const detail = engine.model_details?.find((d) => d.loaded);
    if (detail) return detail.name;
  }
  return null;
}

/** What a job loads when it runs, against the video model the server has loaded. */
export function useLoadsModel(type: string, request: unknown): LoadsModel | null {
  const named = loadsModel(type, request);
  const { data } = useVideoEngines(named?.model != null);
  return named && loadsModel(type, request, loadedVideoModel(data));
}

// Caps are process-static on the server, so unlike video-engines (whose
// loaded/cached flags are invalidated on every model load) one fetch lives
// for the session.
export function useVideoCaps(): Map<string, VideoModelCaps> {
  const { data } = useQuery({
    queryKey: ["video-caps"],
    queryFn: () => api.get<VideoModelCaps[]>("/sdapi/v2/video/capabilities"),
    staleTime: Infinity,
  });
  return useMemo(() => {
    const map = new Map<string, VideoModelCaps>();
    for (const c of data ?? []) map.set(capsKey(c.engine, c.model), c);
    return map;
  }, [data]);
}

// The encoder table is fixed for the server process; a server without the
// route answers 404, which the caller turns into the fallback list.
export function useVideoCodecs() {
  return useQuery({
    queryKey: ["video-codecs"],
    queryFn: () => api.get<VideoCodec[]>("/sdapi/v1/video/codecs"),
    staleTime: Infinity,
    retry: false,
  });
}

export function useLoadVideoModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { engine: string; model: string }) =>
      api.post<VideoLoadResponse>("/sdapi/v2/video/load", params),
    // /video/load mutates the single global "loaded" slot on the server.
    // Invalidate so the loaded-dot in ModelSelector / form badges reflect
    // reality on the next paint without waiting for the 5min staleTime.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["video-engines"] });
    },
  });
}

export function useUnloadVideoModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ messages: string[] }>("/sdapi/v2/video/unload", {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["video-engines"] });
    },
  });
}

export function useFramePackVariants() {
  return useQuery({
    queryKey: ["framepack-variants"],
    queryFn: () => api.get<string[]>("/sdapi/v2/framepack/variants"),
    staleTime: 300_000,
  });
}

export function useLoadFramePack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { variant: string }) =>
      api.post<{ variant: string; messages: string[] }>("/sdapi/v2/framepack/load", params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["framepack-variants"] });
    },
  });
}

export function useUnloadFramePack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ messages: string[] }>("/sdapi/v2/framepack/unload", {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["framepack-variants"] });
    },
  });
}

// Flat list of all local video models, fused from two upstream registries:
// - /sdapi/v2/video/engines (Wan / Hunyuan / LTX /...) - full metadata
// including mode / cached / loaded
// - /sdapi/v2/framepack/variants - bare string array, no metadata
//
// FramePack variants ship without mode/cached/loaded badges because the
// upstream endpoint doesn't expose them. Living with that asymmetry until
// the backend grows a richer endpoint; the dropdown still surfaces them
// for selection.
export function useLocalVideoModels(): LocalVideoModel[] {
  const { data: engines } = useVideoEngines();
  const { data: fpVariants } = useFramePackVariants();
  const capsMap = useVideoCaps();
  return useMemo(() => {
    const result: LocalVideoModel[] = [];
    for (const eng of engines ?? []) {
      for (const detail of eng.model_details ?? []) {
        if (detail.name === "None") continue;
        const caps = capsMap.get(capsKey(eng.engine, detail.name)) ?? null;
        result.push({
          source: "local-video",
          engine: eng.engine,
          model: detail.name,
          name: detail.name,
          title: `local-video:${eng.engine}:${detail.name}`,
          mode: detail.mode,
          workflow: detail.workflow,
          cached: detail.cached,
          loaded: detail.loaded,
          kind: caps ? jobTypeToKind(caps.job_type) : engineToKind(eng.engine),
          caps,
          group_path: detail.group_path ?? [],
        });
      }
    }
    for (const variant of fpVariants ?? []) {
      result.push({
        source: "local-video",
        engine: "FramePack",
        model: variant,
        name: variant,
        title: `local-video:FramePack:${variant}`,
        mode: "t2v",
        workflow: null,
        cached: false,
        loaded: false,
        kind: "framepack",
        caps: capsMap.get(capsKey("FramePack", variant)) ?? null,
        group_path: [],
      });
    }
    return result;
  }, [engines, fpVariants, capsMap]);
}
