import { useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { EditorView } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import { useExtraNetworks, usePromptStyles } from "@/api/hooks/useNetworks";
import {
  promptExtensions,
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
