import type { VideoResult } from "@/api/types/video";

export const DOMAIN_LABELS: Record<VideoResult["domain"], string> = {
  video: "Models",
  framepack: "FP",
  ltx: "LTX",
};

/** The model a result came from, named the way its domain records it. */
export function resultModelName(result: VideoResult): string | undefined {
  const value = result.domain === "framepack" ? result.params.variant : result.params.model;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Short facts that tell two takes of the same model apart. */
export function resultMeta(result: VideoResult): string[] {
  const out: string[] = [];
  const model = resultModelName(result);
  if (model) out.push(model);
  if (result.frames) out.push(`${result.frames}f`);
  if (result.fps) out.push(`${result.fps} fps`);
  out.push(`${result.width}x${result.height}`);
  return out;
}
