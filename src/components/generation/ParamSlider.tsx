import { memo, useCallback } from "react";
import { Slider } from "@/components/ui/slider";
import { NumberInput } from "@/components/ui/number-input";
import { ParamLabel } from "./ParamLabel";
import { cn } from "@/lib/utils";

interface ParamSliderProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  tooltip?: string;
  /** Width (Tailwind class) for the label column. Defaults to "w-[5.5rem]". */
  labelWidth?: string;
}

export const ParamSlider = memo(function ParamSlider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  tooltip,
  labelWidth = "w-[5.5rem]",
}: ParamSliderProps) {
  const handleSliderChange = useCallback(
    ([v]: number[]) => onChange(v),
    [onChange],
  );

  return (
    <div
      data-param={label.toLowerCase()}
      className={cn(
        "flex items-center gap-2",
        disabled && "opacity-50 pointer-events-none",
      )}
    >
      {/* Label — fixed width, truncates on overflow */}
      <ParamLabel
        className={cn("text-2xs shrink-0 truncate", labelWidth)}
        tooltip={tooltip}
      >
        {label}
      </ParamLabel>

      {/* Slider — grows to fill remaining space */}
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={handleSliderChange}
        disabled={disabled}
        className="flex-1 min-w-0"
      />

      {/* Numeric input — fixed narrow width */}
      <NumberInput
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        fallback={min}
        className="w-11 h-5 text-2xs text-right px-1 shrink-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        disabled={disabled}
      />
    </div>
  );
});
