import * as React from "react";
import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

interface NumberInputProps extends Omit<
  React.ComponentProps<"input">,
  "value" | "onChange" | "type"
> {
  value: number;
  onChange: (value: number) => void;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  fallback?: number | undefined;
}

/**
 * Number input that defers clamping until blur/Enter so users can freely
 * type multi-digit values without intermediate states being clamped. Enter
 * commits and keeps editing; only a changed value is written.
 */
const NumberInput = memo(function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  fallback,
  className,
  ...props
}: NumberInputProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  // typed since focus or the last commit
  const [dirty, setDirty] = useState(false);
  const [seen, setSeen] = useState(value);
  if (!Object.is(seen, value)) {
    setSeen(value);
    if (!dirty) setDraft(String(value));
  }

  const commit = () => {
    const parsed = parseFloat(draft);
    let next = fallback ?? min ?? 0;
    if (!Number.isNaN(parsed)) {
      next = parsed;
      if (min != null) next = Math.max(min, next);
      if (max != null) next = Math.min(max, next);
    }
    setDirty(false);
    setDraft(String(next));
    if (!Object.is(next, value)) onChange(next);
  };

  return (
    <Input
      type="number"
      min={min}
      max={max}
      step={step}
      value={editing ? draft : value}
      onFocus={() => {
        setEditing(true);
        setDirty(false);
        setDraft(String(value));
      }}
      onChange={(e) => {
        setDirty(true);
        setDraft(e.target.value);
      }}
      onBlur={() => {
        commit();
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
      className={cn("font-mono tabular-nums", className)}
      {...props}
    />
  );
});

export { NumberInput };
