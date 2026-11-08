import { useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { EditorView } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { useUiStore } from "@/stores/uiStore";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";
import { useExtraNetworks, usePromptStyles } from "@/api/hooks/useNetworks";
import { enableDicts } from "@/api/dicts";
import { useOptions } from "@/api/hooks/useSettings";
import {
  promptExtensions,
  promptAutocomplete,
  embeddingNamesFacet,
  loraNamesFacet,
  styleNamesFacet,
  wildcardNamesFacet,
} from "./prompt-cm";

interface PromptFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Kept and shown, not editable. */
  readOnly?: boolean;
}

function readOnlyExtensions(readOnly: boolean) {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

export function PromptField({
  value,
  onChange,
  placeholder,
  className,
  readOnly = false,
}: PromptFieldProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastValue = useRef(value);
  const onChangeRef = useRef(onChange);
  // eslint-disable-next-line react-hooks/refs -- latest-ref pattern; CodeMirror callback reads via ref
  onChangeRef.current = onChange;

  // Compartments for dynamic data reconfiguration
  const embeddingComp = useRef(new Compartment());
  const loraComp = useRef(new Compartment());
  const styleComp = useRef(new Compartment());
  const wildcardComp = useRef(new Compartment());
  const autocompleteComp = useRef(new Compartment());
  const readOnlyComp = useRef(new Compartment());

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
  const styles = useMemo(() => (Array.isArray(stylesData) ? stylesData : []), [stylesData]);

  // ── Dict tag data (from SD.Next autocomplete_enabled option) ────────────────

  const { data: optionsData } = useOptions();

  // Sync backend autocomplete settings → uiStore (synchronous cache for CodeMirror)
  useEffect(() => {
    if (!optionsData) return;
    const opts = optionsData as Record<string, unknown>;
    const minChars = opts["autocomplete_min_chars"];
    const keepUnderscores = opts["autocomplete_keep_underscores"];
    const appendComma = opts["autocomplete_append_comma"];
    if (typeof minChars === "number") useUiStore.getState().setDictMinChars(minChars);
    if (typeof keepUnderscores === "boolean")
      useUiStore.getState().setDictKeepUnderscores(keepUnderscores);
    if (typeof appendComma === "boolean") useUiStore.getState().setDictAppendComma(appendComma);
  }, [optionsData]);

  const enabledDicts = useMemo(() => {
    const names = (optionsData as Record<string, unknown> | undefined)?.["autocomplete_enabled"];
    return Array.isArray(names) ? names.filter((name) => typeof name === "string") : [];
  }, [optionsData]);
  useEffect(() => enableDicts(enabledDicts), [enabledDicts]);

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
        readOnlyComp.current.of(readOnlyExtensions(readOnly)),
        autocompleteComp.current.of(acEnabled ? promptAutocomplete() : []),
        embeddingComp.current.of(embeddingNamesFacet.of(embeddingNames)),
        loraComp.current.of(loraNamesFacet.of(loras)),
        styleComp.current.of(styleNamesFacet.of(styles)),
        wildcardComp.current.of(wildcardNamesFacet.of(wildcards)),
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

  // ── Re-measure on reveal when hosted inside a KeepAlive panel ────────
  // CodeMirror constructed under display:none measures 0 width and renders
  // unwrapped lines for one frame on first reveal until ResizeObserver fires.
  // Asking for an explicit measure on the hidden→visible transition removes
  // the flash. No-op (already measured) outside a KeepAlive boundary.

  const visible = useKeepAliveVisible();
  useEffect(() => {
    if (visible) viewRef.current?.requestMeasure();
  }, [visible]);

  // ── Toggle autocompletion extension on/off ───────────────────────────

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: autocompleteComp.current.reconfigure(acEnabled ? promptAutocomplete() : []),
    });
  }, [acEnabled]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyComp.current.reconfigure(readOnlyExtensions(readOnly)),
    });
  }, [readOnly]);

  // ── Reconfigure facets when data changes ───────────────────────────

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: embeddingComp.current.reconfigure(embeddingNamesFacet.of(embeddingNames)),
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
      effects: wildcardComp.current.reconfigure(wildcardNamesFacet.of(wildcards)),
    });
  }, [wildcards]);

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      aria-disabled={readOnly || undefined}
      className={cn(
        "border-input bg-muted/30 rounded-md border resize-y overflow-hidden",
        "transition-[color,box-shadow]",
        "[&:has(.cm-focused)]:border-primary/50 [&:has(.cm-focused)]:ring-1 [&:has(.cm-focused)]:ring-primary/20",
        readOnly ? "opacity-50 cursor-not-allowed" : "hover:border-border-hover",
        className,
      )}
    />
  );
}
