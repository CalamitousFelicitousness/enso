import type { Extension } from "@codemirror/state";
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import {
  embeddingNamesFacet,
  loraNamesFacet,
  styleNamesFacet,
  wildcardNamesFacet,
  dictTagsFacet,
} from "./facets";
import type { DictTag } from "@/api/types/dict";

function loraSource(ctx: CompletionContext): CompletionResult | null {
  const match = ctx.matchBefore(/<(?:lora|lyco):[\w\s/.+-]*/i);
  if (!match) return null;
  const colonIdx = match.text.indexOf(":");
  const loras = ctx.state.facet(loraNamesFacet);
  return {
    from: match.from + colonIdx + 1,
    options: loras.map((l) => ({
      label: l.name,
      displayLabel: l.name.split("/").pop() || l.name,
      detail: l.tags?.[0] ?? undefined,
      type: "lora",
      apply: `${l.name}:1>`,
    })),
    validFor: /^[\w\s/.+-]*$/,
  };
}

function styleSource(ctx: CompletionContext): CompletionResult | null {
  const match = ctx.matchBefore(/<style:[\w\s-]*/i);
  if (!match) return null;
  const colonIdx = match.text.indexOf(":");
  const styles = ctx.state.facet(styleNamesFacet);
  return {
    from: match.from + colonIdx + 1,
    options: styles.map((s) => ({
      label: s.name,
      detail: s.description?.slice(0, 40) ?? undefined,
      type: "style",
      apply: `${s.name}>`,
    })),
    validFor: /^[\w\s-]*$/,
  };
}

function wildcardSource(ctx: CompletionContext): CompletionResult | null {
  const match = ctx.matchBefore(/__[\w/.+-]*/);
  if (!match) return null;
  const wildcards = ctx.state.facet(wildcardNamesFacet);
  return {
    from: match.from + 2,
    options: wildcards.map((w) => ({
      label: w.name,
      type: "wildcard",
      apply: `${w.name}__`,
    })),
    validFor: /^[\w/.+-]*$/,
  };
}

function embeddingSource(ctx: CompletionContext): CompletionResult | null {
  const match = ctx.matchBefore(/(?<=^|[\s,])\w{2,}/);
  if (!match) return null;
  const embeddings = ctx.state.facet(embeddingNamesFacet);
  const query = match.text.toLowerCase();
  const filtered = embeddings.filter((n) =>
    n.toLowerCase().includes(query),
  );
  if (filtered.length === 0) return null;
  return {
    from: match.from,
    options: filtered.map((name) => ({ label: name, type: "embedding" })),
    validFor: /^\w+$/,
  };
}

// ── Dict tag category → completion type mapping ──

const DICT_CATEGORY_TYPES: Record<number, string> = {
  0: "dictTag",
  1: "dictArtist",
  3: "dictCopyright",
  4: "dictCharacter",
  5: "dictMeta",
};

/** Binary search for the first tag with the given prefix. */
function lowerBound(tags: DictTag[], prefix: string): number {
  let lo = 0;
  let hi = tags.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (tags[mid].name < prefix) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}k`;
  return String(count);
}

function dictTagSource(ctx: CompletionContext): CompletionResult | null {
  const match = ctx.matchBefore(/(?<=^|[\s,])\w{3,}/);
  if (!match) return null;
  const tags = ctx.state.facet(dictTagsFacet);
  if (tags.length === 0) return null;

  const query = match.text.toLowerCase();
  const MAX_RESULTS = 50;

  // Prefix match via binary search (O(log n + k))
  const start = lowerBound(tags, query);
  const options: { label: string; displayLabel: string; detail: string; type: string; boost: number }[] = [];
  for (let i = start; i < tags.length && options.length < MAX_RESULTS; i++) {
    if (!tags[i].name.startsWith(query)) break;
    options.push({
      label: tags[i].name,
      displayLabel: tags[i].name.replace(/_/g, " "),
      detail: formatCount(tags[i].count),
      type: DICT_CATEGORY_TYPES[tags[i].category] ?? "dictTag",
      boost: -10,
    });
  }

  // Substring fallback for 4+ chars if prefix found nothing
  if (options.length === 0 && query.length >= 4) {
    for (let i = 0; i < tags.length && options.length < MAX_RESULTS; i++) {
      if (tags[i].name.includes(query)) {
        options.push({
          label: tags[i].name,
          displayLabel: tags[i].name.replace(/_/g, " "),
          detail: formatCount(tags[i].count),
          type: DICT_CATEGORY_TYPES[tags[i].category] ?? "dictTag",
          boost: -10,
        });
      }
    }
  }

  if (options.length === 0) return null;
  return { from: match.from, options, validFor: /^\w+$/ };
}

export function promptAutocomplete(): Extension {
  return autocompletion({
    override: [loraSource, styleSource, wildcardSource, embeddingSource, dictTagSource],
    activateOnTyping: true,
    activateOnTypingDelay: 50,
    selectOnOpen: false,
  });
}
