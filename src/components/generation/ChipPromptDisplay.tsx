import { useMemo } from "react";
import { cn } from "@/lib/utils";

type PromptSegment =
  | { type: "text"; content: string }
  | { type: "lora"; displayName: string; weight: string; raw: string };

const LORA_REGEX = /<lora:([^:>]+):([\d.]+)>/g;

function parsePrompt(value: string): PromptSegment[] {
  const segments: PromptSegment[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(LORA_REGEX)) {
    const matchStart = match.index!;
    if (matchStart > lastIndex) {
      segments.push({ type: "text", content: value.slice(lastIndex, matchStart) });
    }
    const fullPath = match[1];
    const displayName = fullPath.split("/").pop() || fullPath;
    segments.push({
      type: "lora",
      displayName,
      weight: match[2],
      raw: match[0],
    });
    lastIndex = matchStart + match[0].length;
  }

  if (lastIndex < value.length) {
    segments.push({ type: "text", content: value.slice(lastIndex) });
  }

  return segments;
}

interface ChipPromptDisplayProps {
  value: string;
  placeholder?: string;
  className?: string;
  onClick: () => void;
}

export function ChipPromptDisplay({
  value,
  placeholder,
  className,
  onClick,
}: ChipPromptDisplayProps) {
  const segments = useMemo(() => parsePrompt(value), [value]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      className={cn(
        "border-input bg-muted/30 flex w-full min-w-0 rounded-md border px-2.5 py-2 text-2xs cursor-text",
        "whitespace-pre-wrap break-words overflow-y-auto",
        className,
      )}
    >
      {value ? (
        segments.map((seg, i) =>
          seg.type === "text" ? (
            <span key={i}>{seg.content}</span>
          ) : (
            <span
              key={i}
              className="inline-flex items-center gap-0.5 px-2 py-px mx-0.5 rounded-full align-baseline bg-primary/10 ring-1 ring-primary/15"
            >
              <span className="text-2xs font-medium text-primary/90">
                {seg.displayName}
              </span>
              <span className="text-3xs font-mono text-primary/50">
                {seg.weight}
              </span>
            </span>
          ),
        )
      ) : (
        <span className="text-muted-foreground/40">{placeholder}</span>
      )}
    </div>
  );
}
