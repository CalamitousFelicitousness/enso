import { useEffect, useRef, useState } from "react";
import { ParamLabel } from "@/components/generation/ParamLabel";

interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  tooltip?: string;
}

export function ColorPicker({ label, value, onChange, tooltip }: ColorPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // React's onChange follows every `input` event while the picker is open; the
  // setting takes the colour on the native `change`, when the picker commits.
  const [draft, setDraft] = useState<string | null>(null);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(null);
  }
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const commit = () => {
      setDraft(null);
      if (input.value !== latest.current.value) latest.current.onChange(input.value);
    };
    input.addEventListener("change", commit);
    return () => input.removeEventListener("change", commit);
  }, []);

  const shown = draft ?? value;

  return (
    <div className="flex items-center gap-2">
      <ParamLabel className="text-2xs text-muted-foreground w-16 flex-shrink-0" tooltip={tooltip}>
        {label}
      </ParamLabel>
      <div className="flex items-center gap-1.5 flex-1">
        <input
          ref={inputRef}
          type="color"
          value={shown}
          onChange={(e) => setDraft(e.target.value === value ? null : e.target.value)}
          className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent p-0"
        />

        <span className="text-2xs text-muted-foreground font-mono">{shown}</span>
      </div>
    </div>
  );
}
