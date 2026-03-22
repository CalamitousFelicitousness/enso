import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { useExtraNetworks } from "@/api/hooks/useNetworks";
import { setPromptCursor } from "@/lib/promptCursor";
import {
  parsePromptSegments,
  buildEmbeddingRegex,
  hasSpecialTokens,
  type PromptSegment,
} from "@/lib/promptParser";

interface PromptFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

// ── Segment raw-text length ──────────────────────────────────────────

function rawLength(seg: PromptSegment): number {
  switch (seg.type) {
    case "text":
      return seg.content.length;
    case "embedding":
      return seg.name.length;
    default:
      return seg.raw.length;
  }
}

// ── Segment renderers ────────────────────────────────────────────────

const tokenBase =
  "inline rounded-sm px-1 mx-px font-medium leading-none text-3xs";

function renderSegment(seg: PromptSegment, i: number, offset: number) {
  // data-offset lets the parent's click handler map visual position → raw cursor
  switch (seg.type) {
    case "text":
      return (
        <span key={i} data-offset={offset}>
          {seg.content}
        </span>
      );

    case "lora":
      return (
        <span
          key={i}
          data-offset={offset}
          className={cn(tokenBase, "bg-primary/10 text-primary/90")}
        >
          {seg.displayName}
          <sup className="text-4xs font-mono text-primary/40 ml-px">
            {seg.weight}
          </sup>
        </span>
      );

    case "style":
      return (
        <span
          key={i}
          data-offset={offset}
          className={cn(tokenBase, "bg-violet-500/10 text-violet-400")}
        >
          {seg.name}
        </span>
      );

    case "wildcard":
      return (
        <span
          key={i}
          data-offset={offset}
          className={cn(tokenBase, "bg-amber-500/10 text-amber-400/90")}
        >
          {seg.name}
        </span>
      );

    case "attention":
      return (
        <span
          key={i}
          data-offset={offset}
          className={cn(tokenBase, "bg-foreground/[0.04]")}
        >
          {seg.content}
          <sup className="text-4xs font-mono text-muted-foreground/60 ml-px">
            {seg.weight}
          </sup>
        </span>
      );

    case "embedding":
      return (
        <span
          key={i}
          data-offset={offset}
          className={cn(tokenBase, "bg-emerald-500/10 text-emerald-400/90")}
        >
          {seg.name}
        </span>
      );
  }
}

// ── Attention weight adjustment (Ctrl+Arrow) ─────────────────────────

function adjustAttentionWeight(textarea: HTMLTextAreaElement, delta: number) {
  const { selectionStart, selectionEnd, value } = textarea;
  if (selectionStart === selectionEnd) return;

  const selected = value.slice(selectionStart, selectionEnd);
  const match = selected.match(/^\((.+):([0-9.]+)\)$/);

  if (match) {
    const newWeight = Math.max(0, Math.min(2, parseFloat(match[2]) + delta));
    const replacement = `(${match[1]}:${newWeight.toFixed(1)})`;
    textarea.value =
      value.slice(0, selectionStart) + replacement + value.slice(selectionEnd);
    textarea.selectionStart = selectionStart;
    textarea.selectionEnd = selectionStart + replacement.length;
  } else {
    const weight = Math.max(0, Math.min(2, 1.0 + delta));
    const replacement = `(${selected}:${weight.toFixed(1)})`;
    textarea.value =
      value.slice(0, selectionStart) + replacement + value.slice(selectionEnd);
    textarea.selectionStart = selectionStart;
    textarea.selectionEnd = selectionStart + replacement.length;
  }
}

// ── PromptField ──────────────────────────────────────────────────────

export function PromptField({
  value,
  onChange,
  placeholder,
  className,
}: PromptFieldProps) {
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const savedCursor = useRef<number>(0);
  const savedScroll = useRef<number>(0);
  const savedHeight = useRef<number | undefined>(undefined);

  // Fetch embedding names for detection (shared cache across all instances)
  const { data: embeddingsData } = useExtraNetworks({
    page: "embedding",
    limit: 5000,
  });
  const embeddingRe = useMemo(() => {
    if (!embeddingsData?.items?.length) return null;
    return buildEmbeddingRegex(embeddingsData.items.map((e) => e.name));
  }, [embeddingsData]);

  const segments = useMemo(
    () => parsePromptSegments(value, embeddingRe),
    [value, embeddingRe],
  );

  // Focus textarea and restore cursor + scroll when switching to edit mode
  useEffect(() => {
    if (focused && textareaRef.current) {
      const el = textareaRef.current;
      el.focus();
      const pos = Math.min(savedCursor.current, el.value.length);
      el.selectionStart = pos;
      el.selectionEnd = pos;
      el.scrollTop = savedScroll.current;
    }
  }, [focused]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        e.ctrlKey &&
        (e.key === "ArrowUp" || e.key === "ArrowDown")
      ) {
        e.preventDefault();
        adjustAttentionWeight(
          e.currentTarget,
          e.key === "ArrowUp" ? 0.1 : -0.1,
        );
        onChange(e.currentTarget.value);
      }
    },
    [onChange],
  );

  // Click on chip display: find which segment was clicked via data-offset,
  // save scroll position, then switch to edit mode.
  const handleChipClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = (e.target as HTMLElement).closest(
        "[data-offset]",
      ) as HTMLElement | null;
      if (target?.dataset.offset) {
        savedCursor.current = parseInt(target.dataset.offset, 10);
        setPromptCursor(savedCursor.current);
      }
      savedScroll.current = chipRef.current?.scrollTop ?? 0;
      savedHeight.current = chipRef.current?.offsetHeight;
      setFocused(true);
    },
    [],
  );

  const hasContent = value.trim().length > 0;
  const showTokens =
    hasContent &&
    !focused &&
    (hasSpecialTokens(value) || segments.some((s) => s.type === "embedding"));

  // Precompute raw-text offsets for click → cursor mapping
  const segmentOffsets = useMemo(() => {
    const offsets: number[] = [];
    let off = 0;
    for (const seg of segments) {
      offsets.push(off);
      off += rawLength(seg);
    }
    return offsets;
  }, [segments]);

  if (showTokens) {
    return (
      <div
        ref={(el) => {
          chipRef.current = el;
          if (el) {
            el.scrollTop = savedScroll.current;
            if (savedHeight.current) el.style.height = `${savedHeight.current}px`;
          }
        }}
        role="button"
        tabIndex={0}
        onClick={handleChipClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            savedScroll.current = chipRef.current?.scrollTop ?? 0;
            savedHeight.current = chipRef.current?.offsetHeight;
            setFocused(true);
          }
        }}
        className={cn(
          // Match Textarea base styles exactly
          "border-input bg-muted/30 w-full min-w-0 rounded-md border px-2.5 py-2 text-3xs cursor-text resize-y",
          "whitespace-pre-wrap break-words overflow-y-auto",
          className,
        )}
      >
        {segments.map((seg, i) => renderSegment(seg, i, segmentOffsets[i]))}
      </div>
    );
  }

  return (
    <Textarea
      ref={(el) => {
        textareaRef.current = el;
        if (el && savedHeight.current) el.style.height = `${savedHeight.current}px`;
      }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn("text-3xs field-sizing-fixed", className)}
      onBlur={(e) => {
        savedCursor.current = e.currentTarget.selectionStart;
        savedScroll.current = e.currentTarget.scrollTop;
        savedHeight.current = e.currentTarget.offsetHeight;
        setPromptCursor(e.currentTarget.selectionStart);
        setFocused(false);
      }}
      onKeyDown={handleKeyDown}
    />
  );
}
