import type { ExtraNetworkV2, PromptStyleV2 } from "@/api/types/models";
import type { ActiveLora, NetworkItem } from "./types";

export function isExtraNetwork(
  item: NetworkItem,
): item is ExtraNetworkV2 {
  return "type" in item && !!item.type;
}

export function isReferenceName(name: string): boolean {
  return name.toLowerCase().includes("reference/");
}

export function isItemActive(
  item: NetworkItem,
  prompt: string,
  options: Record<string, unknown> | undefined,
): boolean {
  if (!isExtraNetwork(item)) {
    const style = item as PromptStyleV2;
    return !!style.prompt && prompt.includes(style.prompt);
  }
  const t = item.type?.toLowerCase() ?? "";
  if (t === "model" || t === "checkpoint")
    return (
      (item.title ?? item.name) === (options?.sd_model_checkpoint as string)
    );
  if (t === "lora" || t === "lycoris")
    return prompt.includes(`<lora:${item.name}:`);
  if (t === "embedding" || t === "textual inversion")
    return prompt.includes(item.name);
  if (t === "wildcards") return prompt.includes(`__${item.name}__`);
  if (t === "vae")
    return (item.title ?? item.name) === (options?.sd_vae as string);
  return false;
}

/** Get the path used for folder grouping - fullname has the relative path, name may be just a basename. */
export function itemPath(item: NetworkItem): string {
  if (isExtraNetwork(item)) return item.fullname ?? item.name;
  return item.name;
}

export function itemHasTag(item: ExtraNetworkV2, tag: string): boolean {
  return item.tags.some((t) => t.toLowerCase() === tag.toLowerCase());
}

/* ─── LoRA prompt utilities ────────────────────────────────── */

const LORA_RE = /<lora:([^:>]+):([\d.]+)>/g;

export function parseActiveLoRAs(prompt: string): ActiveLora[] {
  const results: ActiveLora[] = [];
  let match: RegExpExecArray | null;
  LORA_RE.lastIndex = 0;
  while ((match = LORA_RE.exec(prompt)) !== null) {
    results.push({ name: match[1], weight: parseFloat(match[2]) });
  }
  return results;
}

export function setLoRAWeight(
  prompt: string,
  name: string,
  weight: number,
): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<lora:${escaped}:[\\d.]+>`, "g");
  return prompt.replace(re, `<lora:${name}:${weight}>`);
}

export function removeLoRA(prompt: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\s*<lora:${escaped}:[\\d.]+>`, "g");
  return prompt.replace(re, "").trim();
}

export function addLoRA(
  prompt: string,
  name: string,
  weight: number = 1,
): string {
  const tag = `<lora:${name}:${weight}>`;
  return prompt ? `${prompt} ${tag}` : tag;
}
