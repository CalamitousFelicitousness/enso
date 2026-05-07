import { ParamSlider, type ParamSliderProps } from "./ParamSlider";

interface InheritableSliderProps extends Omit<
  ParamSliderProps,
  "value" | "onChange" | "defaultValue"
> {
  /** The value inherited from defaults when no override is set. */
  inheritedValue: number;
  /** The user's explicit override; undefined = inherit. */
  overrideValue: number | undefined;
  /** Set the user override. */
  onOverride: (v: number) => void;
  /** Clear the override and revert to inheriting. */
  onClear: () => void;
}

/** ParamSlider wrapper with inherit/override semantics.
 *
 * When `overrideValue` is undefined, displays the inherited value with a dim
 * indicator dot. Setting the slider promotes to an override; right-click
 * "Reset to default" calls `onClear` to revert. The wire format can then
 * distinguish "explicitly set" from "inherit".
 */
export function InheritableSlider({
  inheritedValue,
  overrideValue,
  onOverride,
  onClear,
  ...rest
}: InheritableSliderProps) {
  const isOverride = overrideValue !== undefined;
  const value = overrideValue ?? inheritedValue;
  // ParamSlider's "Reset to default" context menu calls onChange(defaultValue),
  // which we interpret as a clear. Treating "value set to inherited" as clear
  // means the wire format omits the field whenever the user reverts.
  const handleChange = (v: number) => {
    if (v === inheritedValue) onClear();
    else onOverride(v);
  };
  return (
    <div className="relative" data-inheritable-state={isOverride ? "override" : "inherit"}>
      <span
        aria-hidden
        className={
          "pointer-events-none absolute -left-1.5 top-1/2 size-1 -translate-y-1/2 rounded-full transition-colors " +
          (isOverride ? "bg-primary" : "bg-muted-foreground/30")
        }
        title={isOverride ? "Override (right-click to reset)" : "Inheriting from defaults"}
      />
      <ParamSlider {...rest} value={value} defaultValue={inheritedValue} onChange={handleChange} />
    </div>
  );
}
