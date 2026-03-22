import type { Extension } from "@codemirror/state";
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import {
  embeddingNamesFacet,
  loraNamesFacet,
  styleNamesFacet,
  wildcardNamesFacet,
} from "./facets";

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

export function promptAutocomplete(): Extension {
  return autocompletion({
    override: [loraSource, styleSource, wildcardSource, embeddingSource],
    activateOnTyping: true,
    activateOnTypingDelay: 50,
    selectOnOpen: false,
  });
}
