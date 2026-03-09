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
}: ParamSliderProps) {
  const handleSliderChange = useCallback(
    ([v]: number[]) => onChange(v),
    [onChange],
  );

  return (
    <div
      data-param={label.toLowerCase()}
      className={cn(
        "flex flex-col gap-1.5",
        disabled && "opacity-50 pointer-events-none",
      )}
    >
      {/* Row 1: label left, value right */}
      <div className="flex items-baseline justify-between gap-1">
        <ParamLabel className="text-2xs truncate leading-none" tooltip={tooltip}>
          {label}
        </ParamLabel>
        <NumberInput
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={onChange}
          fallback={min}
          disabled={disabled}
          className="w-10 h-4 text-3xs text-right px-1 leading-none shrink-0 bg-transparent border-transparent shadow-none focus-visible:border-border focus-visible:bg-input/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
      </div>

      {/* Row 2: slider full-width */}
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={handleSliderChange}
        disabled={disabled}
      />
    </div>
  );
});
