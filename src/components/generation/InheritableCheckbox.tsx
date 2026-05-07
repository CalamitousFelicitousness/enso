import { Checkbox } from "@/components/ui/checkbox";
import { ParamLabel } from "./ParamLabel";

interface InheritableCheckboxProps {
  label: string;
  tooltip?: string;
  inheritedValue: boolean;
  overrideValue: boolean | undefined;
  onOverride: (v: boolean) => void;
  onClear: () => void;
  disabled?: boolean;
}

/** Checkbox wrapper with inherit/override semantics.
 *
 * When `overrideValue` is undefined, displays the inherited value with a dim
 * indicator dot. Clicking promotes to an override matching whatever you toggle
 * to; if the new value happens to equal the inherited value, the override is
 * cleared so the wire format keeps the field omitted.
 */
export function InheritableCheckbox({
  label,
  tooltip,
  inheritedValue,
  overrideValue,
  onOverride,
  onClear,
  disabled,
}: InheritableCheckboxProps) {
  const isOverride = overrideValue !== undefined;
  const value = overrideValue ?? inheritedValue;
  const handleChange = (c: boolean | "indeterminate") => {
    const v = !!c;
    if (v === inheritedValue) onClear();
    else onOverride(v);
  };
  return (
    <label
      className="relative flex items-center gap-1.5 text-2xs text-muted-foreground cursor-pointer"
      data-inheritable-state={isOverride ? "override" : "inherit"}
    >
      <span
        aria-hidden
        className={
          "pointer-events-none absolute -left-1.5 top-1/2 size-1 -translate-y-1/2 rounded-full transition-colors " +
          (isOverride ? "bg-primary" : "bg-muted-foreground/30")
        }
        title={
          isOverride
            ? "Override (click to toggle, returns to inherit if matches default)"
            : "Inheriting from defaults"
        }
      />
      <Checkbox checked={value} onCheckedChange={handleChange} disabled={disabled} />
      <ParamLabel className="text-2xs text-muted-foreground" tooltip={tooltip}>
        {label}
      </ParamLabel>
    </label>
  );
}
