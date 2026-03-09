import * as React from "react";
import { Slider as SliderPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  onValueChange,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max],
  );

  const [dragging, setDragging] = React.useState(false);
  const dragTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const handleValueChange = React.useCallback(
    (newValue: number[]) => {
      // Clear any pending timeout
      if (dragTimeoutRef.current) {
        clearTimeout(dragTimeoutRef.current);
      }

      // If we're not already in dragging state, enter it
      if (!dragging) {
        setDragging(true);
      }

      // Set a timeout to exit dragging state after a short delay
      // If another change fires before this, it clears and resets (indicating a drag)
      // If it completes, we exit dragging (indicating a click)
      dragTimeoutRef.current = setTimeout(() => {
        setDragging(false);
      }, 50);

      onValueChange?.(newValue);
    },
    [dragging, onValueChange],
  );

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      data-dragging={dragging ? "" : undefined}
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      onValueChange={handleValueChange}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="bg-muted relative grow data-[orientation=horizontal]:h-[5px] data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-[5px]"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="bg-primary/60 absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full data-[not-dragging]:transition-[width] data-[not-dragging]:duration-100 data-[not-dragging]:ease-out"
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className="relative block h-[10px] w-[2px] shrink-0 bg-primary outline-none transition-[height,box-shadow] data-[not-dragging]:transition-[height,box-shadow,transform] data-[not-dragging]:duration-100 data-[not-dragging]:ease-out focus-visible:h-[13px] focus-visible:shadow-[0_0_0_2px_var(--ring)] disabled:pointer-events-none"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
