import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../client";
import type {
  PostprocessControl,
  PostprocessScript,
  PostprocessScriptsResponse,
} from "../types/process";

/** The server's postprocessing scripts in their run order. */
export function usePostprocessScripts() {
  return useQuery({
    queryKey: ["postprocess-scripts"],
    queryFn: () => api.get<PostprocessScriptsResponse>("/sdapi/v2/postprocess/scripts"),
    staleTime: 300_000,
  });
}

/** The choices one script control offers, as combobox options. */
export function usePostprocessChoices(script: string, control: string): string[] {
  const { data } = usePostprocessScripts();
  return useMemo(() => {
    const found = data?.scripts.find((s: PostprocessScript) => s.name === script);
    const ctl = found?.controls?.find((c: PostprocessControl) => c.name === control);
    return (ctl?.choices ?? []).map(String);
  }, [data, script, control]);
}
