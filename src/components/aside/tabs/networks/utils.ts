import type { ExtraNetworkV2 } from "@/api/types/models";
import { networkTags, type NetworkTag } from "@/lib/recipes/networks";
import type { ActiveLora, NetworkItem } from "./types";

export function isExtraNetwork(item: NetworkItem): item is ExtraNetworkV2 {
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
    const style = item;
    return !!style.prompt && prompt.includes(style.prompt);
  }
  const t = item.type?.toLowerCase() ?? "";
  if (t === "model" || t === "checkpoint")
    return (item.title ?? item.name) === (options?.["sd_model_checkpoint"] as string);
  if (t === "lora" || t === "lycoris") return prompt.includes(`<lora:${item.name}:`);
  if (t === "embedding" || t === "textual inversion") return prompt.includes(item.name);
  if (t === "wildcards") return prompt.includes(`__${item.name}__`);
  if (t === "vae") return (item.title ?? item.name) === (options?.["sd_vae"] as string);
  return false;
}

/** Get the path used for folder grouping - fullname has the relative path, name may be just a basename. */
export function itemPath(item: NetworkItem): string {
  if (isExtraNetwork(item)) return item.fullname ?? item.name;
  return item.name;
}

export function itemHasTag(item: ExtraNetworkV2, tag: string): boolean {
  return (item.tags ?? []).some((t) => t.toLowerCase() === tag.toLowerCase());
}

/* ─── LoRA prompt utilities ────────────────────────────────── */

function loraTags(prompt: string): NetworkTag[] {
  return networkTags(prompt).filter((tag) => tag.kind === "lora");
}

/** The prompt with each `<lora:name...>` tag, and the whitespace before it when
 * `withSpace`, replaced; last first so earlier spans hold. */
function replaceLoRA(prompt: string, name: string, insert: string, withSpace = false): string {
  let out = prompt;
  for (const tag of loraTags(prompt).reverse()) {
    if (tag.name !== name) continue;
    let from = tag.from;
    while (withSpace && from > 0 && /\s/.test(out[from - 1])) from--;
    out = out.slice(0, from) + insert + out.slice(tag.to);
  }
  return out;
}

export function parseActiveLoRAs(prompt: string): ActiveLora[] {
  return loraTags(prompt).map((tag) => {
    const weight = Number.parseFloat(tag.weights[0] ?? "1");
    return { name: tag.name, weight: Number.isFinite(weight) ? weight : 1 };
  });
}

export function setLoRAWeight(prompt: string, name: string, weight: number): string {
  return replaceLoRA(prompt, name, `<lora:${name}:${weight}>`);
}

export function removeLoRA(prompt: string, name: string): string {
  return replaceLoRA(prompt, name, "", true).trim();
}

export function addLoRA(prompt: string, name: string, weight: number = 1): string {
  const tag = `<lora:${name}:${weight}>`;
  return prompt ? `${prompt} ${tag}` : tag;
}
