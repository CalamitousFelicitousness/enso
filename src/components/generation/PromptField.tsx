import { useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { EditorView } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import { useUiStore } from "@/stores/uiStore";
import { useExtraNetworks, usePromptStyles } from "@/api/hooks/useNetworks";
import { useDictTagsMulti } from "@/api/hooks/useDicts";
import { useOptions } from "@/api/hooks/useSettings";
import type { DictTag } from "@/api/types/dict";
import {
  promptExtensions,
  promptAutocomplete,
  embeddingNamesFacet,
  loraNamesFacet,
  styleNamesFacet,
  wildcardNamesFacet,
  dictTagsFacet,
} from "./prompt-cm";

interface PromptFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function PromptField({
  value,
  onChange,
  placeholder,
  className,
}: PromptFieldProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastValue = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Compartments for dynamic data reconfiguration
  const embeddingComp = useRef(new Compartment());
  const loraComp = useRef(new Compartment());
  const styleComp = useRef(new Compartment());
  const wildcardComp = useRef(new Compartment());
  const dictComp = useRef(new Compartment());
  const autocompleteComp = useRef(new Compartment());

  const acEnabled = useUiStore((s) => s.promptAutocomplete);

  // ── Fetch network data (shared TanStack Query cache) ───────────────

  const { data: embeddingsData } = useExtraNetworks({
    page: "embedding",
    limit: 5000,
  });
  const embeddingNames = useMemo(
    () => embeddingsData?.items?.map((e) => e.name) ?? [],
    [embeddingsData],
  );

  const { data: loraData } = useExtraNetworks({ page: "lora", limit: 5000 });
  const loras = useMemo(() => loraData?.items ?? [], [loraData]);

  const { data: wildcardData } = useExtraNetworks({
    page: "wildcards",
    limit: 5000,
  });
  const wildcards = useMemo(() => wildcardData?.items ?? [], [wildcardData]);

  const { data: stylesData } = usePromptStyles();
  const styles = useMemo(
    () => (Array.isArray(stylesData) ? stylesData : []),
    [stylesData],
  );

  // ── Dict tag data (from SD.Next autocomplete_enabled option) ────────────────

  const { data: optionsData } = useOptions();

  // Sync backend autocomplete settings → uiStore (synchronous cache for CodeMirror)
  useEffect(() => {
    if (!optionsData) return;
    const opts = optionsData as Record<string, unknown>;
    const minChars = opts.autocomplete_min_chars;
    const replaceUnderscores = opts.autocomplete_replace_underscores;
    if (typeof minChars === "number") useUiStore.getState().setDictMinChars(minChars);
    if (typeof replaceUnderscores === "boolean") useUiStore.getState().setDictReplaceUnderscores(replaceUnderscores);
  }, [optionsData]);

  const enabledDicts = useMemo(
    () => (optionsData as Record<string, unknown>)?.autocomplete_enabled as string[] ?? [],
    [optionsData],
  );
  const dictQueries = useDictTagsMulti(enabledDicts);
  const mergedDictTags = useMemo(() => {
    const all = dictQueries.flatMap((q) => q.data ?? []);
    if (all.length === 0) return all;
    all.sort((a, b) => a.name.localeCompare(b.name));
    // Deduplicate consecutive entries, keeping the highest post count
    const deduped: DictTag[] = [all[0]];
    for (let i = 1; i < all.length; i++) {
      if (all[i].name !== all[i - 1].name) {
        deduped.push(all[i]);
      } else if (all[i].count > deduped[deduped.length - 1].count) {
        deduped[deduped.length - 1] = all[i];
      }
    }
    return deduped;
  }, [dictQueries]);

  // ── Create editor on mount ─────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;

    const onDocChange = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const next = update.state.doc.toString();
        lastValue.current = next;
        onChangeRef.current(next);
      }
    });

    const view = new EditorView({
      doc: value,
      extensions: [
        ...promptExtensions(placeholder),
        onDocChange,
        autocompleteComp.current.of(acEnabled ? promptAutocomplete() : []),
        embeddingComp.current.of(embeddingNamesFacet.of(embeddingNames)),
        loraComp.current.of(loraNamesFacet.of(loras)),
        styleComp.current.of(styleNamesFacet.of(styles)),
        wildcardComp.current.of(wildcardNamesFacet.of(wildcards)),
        dictComp.current.of(dictTagsFacet.of(mergedDictTags)),
      ],
      parent: containerRef.current,
    });

    viewRef.current = view;
    lastValue.current = value;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  // ── Sync external value → editor ───────────────────────────────────

  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === lastValue.current) return;
    const doc = view.state.doc.toString();
    if (value !== doc) {
      view.dispatch({
        changes: { from: 0, to: doc.length, insert: value },
      });
    }
    lastValue.current = value;
  }, [value]);

  // ── Toggle autocompletion extension on/off ───────────────────────────

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: autocompleteComp.current.reconfigure(
        acEnabled ? promptAutocomplete() : [],
      ),
    });
  }, [acEnabled]);

  // ── Reconfigure facets when data changes ───────────────────────────

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: embeddingComp.current.reconfigure(
        embeddingNamesFacet.of(embeddingNames),
      ),
    });
  }, [embeddingNames]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: loraComp.current.reconfigure(loraNamesFacet.of(loras)),
    });
  }, [loras]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: styleComp.current.reconfigure(styleNamesFacet.of(styles)),
    });
  }, [styles]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wildcardComp.current.reconfigure(
        wildcardNamesFacet.of(wildcards),
      ),
    });
  }, [wildcards]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: dictComp.current.reconfigure(
        dictTagsFacet.of(mergedDictTags),
      ),
    });
  }, [mergedDictTags]);

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className={cn(
        "border-input bg-muted/30 rounded-md border resize-y overflow-hidden",
        "transition-[color,box-shadow]",
        "[&:has(.cm-focused)]:border-primary/50 [&:has(.cm-focused)]:ring-1 [&:has(.cm-focused)]:ring-primary/20",
        "hover:border-border-hover",
        className,
      )}
    />
  );
}
