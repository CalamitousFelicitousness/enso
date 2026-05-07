import type { ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { ParamLabel } from "./ParamLabel";

interface InheritableTextInputProps {
  label: string;
  tooltip?: string;
  inheritedValue: string;
  overrideValue: string | undefined;
  onOverride: (v: string) => void;
  onClear: () => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/** Text input wrapper with inherit/override semantics.
 *
 * When `overrideValue` is undefined, displays the inherited value as
 * placeholder-style text and the field is "transparent". Typing promotes
 * to an override; clearing the field calls onClear so the wire format omits
 * the field again. Empty string is NOT a valid override (use clear semantics).
 */
export function InheritableTextInput({
  label,
  tooltip,
  inheritedValue,
  overrideValue,
  onOverride,
  onClear,
  disabled,
  placeholder,
  className,
}: InheritableTextInputProps) {
  const isOverride = overrideValue !== undefined;
  const value = overrideValue ?? "";
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    if (next === "") onClear();
    else onOverride(next);
  };
  return (
    <div
      className="relative flex flex-col gap-1"
      data-inheritable-state={isOverride ? "override" : "inherit"}
    >
      <span
        aria-hidden
        className={
          "pointer-events-none absolute -left-1.5 top-2.5 size-1 rounded-full transition-colors " +
          (isOverride ? "bg-primary" : "bg-muted-foreground/30")
        }
        title={
          isOverride ? "Override (clear field to revert to inherit)" : "Inheriting from defaults"
        }
      />
      <ParamLabel className="text-2xs text-muted-foreground" tooltip={tooltip}>
        {label}
      </ParamLabel>
      <Input
        value={value}
        onChange={handleChange}
        disabled={disabled}
        placeholder={placeholder ?? (inheritedValue || "")}
        className={className}
      />
    </div>
  );
}
