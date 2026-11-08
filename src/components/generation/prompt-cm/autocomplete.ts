import type { Extension } from "@codemirror/state";
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { embeddingNamesFacet, loraNamesFacet, styleNamesFacet, wildcardNamesFacet } from "./facets";
import { lookupDictTags } from "@/api/dicts";
import { NAME_PART, PARTIAL_TAG } from "@/lib/recipes/networks";
import { useUiStore } from "@/stores/uiStore";

function loraSource(ctx: CompletionContext): CompletionResult | null {
  const match = ctx.matchBefore(PARTIAL_TAG);
  if (!match) return null;
  const colonIdx = match.text.indexOf(":");
  const loras = ctx.state.facet(loraNamesFacet);
  return {
    from: match.from + colonIdx + 1,
    options: loras.map((l) => ({
      label: l.name,
      displayLabel: l.name.split("/").pop() || l.name,
      detail: l.tags?.[0] ?? "",
      type: "lora",
      apply: `${l.name}:1>`,
    })),
    validFor: NAME_PART,
  };
}

function styleSource(ctx: CompletionContext): CompletionResult | null {
  const match = ctx.matchBefore(/<style:[\w\s-]*/i);
  if (!match) return null;
  const colonIdx = match.text.indexOf(":");
  const styles = ctx.state.facet(styleNamesFacet);
  return {
    from: match.from + colonIdx + 1,
    options: styles.map((s) => {
      const detail = s.description?.slice(0, 40);
      return {
        label: s.name,
        ...(detail !== undefined && { detail }),
        type: "style",
        apply: `${s.name}>`,
      };
    }),
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

/** Where the typed text sits in a shown label, for highlighting. */
function matchRange(label: string, typed: string): number[] {
  const at = label.toLowerCase().indexOf(typed);
  return at < 0 ? [] : [at, at + typed.length];
}

// Embeddings and dictionary tags come in the order given (filter: false), and
// unfiltered results keep their source's place in the list: embeddings first.
function embeddingSource(ctx: CompletionContext): CompletionResult | null {
  const match = ctx.matchBefore(/(?<=^|[\s,])\w{2,}/);
  if (!match) return null;
  const embeddings = ctx.state.facet(embeddingNamesFacet);
  const query = match.text.toLowerCase();
  const starting: string[] = [];
  const containing: string[] = [];
  for (const name of embeddings) {
    const lower = name.toLowerCase();
    if (lower.startsWith(query)) starting.push(name);
    else if (lower.includes(query)) containing.push(name);
  }
  if (starting.length + containing.length === 0) return null;
  const byName = (a: string, b: string) => a.localeCompare(b);
  return {
    from: match.from,
    options: [...starting.sort(byName), ...containing.sort(byName)].map((name) => ({
      label: name,
      type: "embedding",
    })),
    filter: false,
    getMatch: (option) => matchRange(option.label, query),
  };
}

// ── Dict tag category → completion type mapping ──

const DICT_CATEGORY_TYPES: Record<number, string> = {
  0: "dictGeneral",
  1: "dictArtist",
  2: "dictStudio",
  3: "dictCopyright",
  4: "dictCharacter",
  5: "dictSpecies",
  6: "dictGenre",
  7: "dictMedium",
  8: "dictMeta",
  9: "dictLore",
  10: "dictLens",
  11: "dictLighting",
  12: "dictComposition",
  13: "dictColor",
};

function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}k`;
  return String(count);
}

const MAX_DICT_RESULTS = 50;

async function dictTagSource(ctx: CompletionContext): Promise<CompletionResult | null> {
  const { dictMinChars, dictKeepUnderscores, dictAppendComma } = useUiStore.getState();
  const minCharsPattern = new RegExp(`(?<=^|[\\s,])\\w{${dictMinChars},}`);
  const match = ctx.matchBefore(minCharsPattern);
  if (!match) return null;
  const typed = match.text.toLowerCase();
  const tags = await lookupDictTags(typed, MAX_DICT_RESULTS);
  if (ctx.aborted || tags.length === 0) return null;

  const formatName = dictKeepUnderscores ? (n: string) => n : (n: string) => n.replace(/_/g, " ");
  const spaced = (n: string) => n.replace(/_/g, " ");
  const suffix = dictAppendComma ? ", " : " ";
  const options = tags.map((tag) => {
    const name = formatName(tag.name);
    return {
      label: name,
      // a tag found by an alias or translation shows that term beside it
      displayLabel:
        tag.via === undefined ? spaced(tag.name) : `${spaced(tag.name)} (${spaced(tag.via)})`,
      detail: formatCount(tag.count),
      type: DICT_CATEGORY_TYPES[tag.category] ?? "dictGeneral",
      apply: name + suffix,
    };
  });
  // the worker ranks; asked again on every keystroke
  return {
    from: match.from,
    options,
    filter: false,
    getMatch: (option) => matchRange(option.displayLabel ?? option.label, spaced(typed)),
  };
}

export function promptAutocomplete(): Extension {
  return autocompletion({
    override: [loraSource, styleSource, wildcardSource, embeddingSource, dictTagSource],
    activateOnTyping: true,
    activateOnTypingDelay: 50,
    selectOnOpen: false,
  });
}
