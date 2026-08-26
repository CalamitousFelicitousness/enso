import { useState } from "react";
import { Link2Off, ArrowLeftRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import type { AspectPreset } from "@/lib/aspect";

interface AspectRatioControlProps {
  presets: AspectPreset[];
  activePreset: string | null;
  onSelectPreset: (p: AspectPreset | null) => void;
  onSwap: () => void;
  disabled?: boolean | undefined;
  /** Cloud models with fixed WxH options replace the ratio list. */
  absolutePresets?: AspectPreset[] | null | undefined;
  onSelectAbsolute?: ((p: AspectPreset) => void) | undefined;
  /** Trigger readout when absolute presets are active but none is selected. */
  currentSize?: { w: number; h: number } | undefined;
  /** Presets with no legal size pair under the current limits are disabled. */
  isPresetDisabled?: ((p: AspectPreset) => boolean) | undefined;
}

// Aspect-ratio preset popover plus the width/height swap button. Shared by
// the image and video size controls; lock state lives in useAspectLock.
export function AspectRatioControl({
  presets,
  activePreset,
  onSelectPreset,
  onSwap,
  disabled,
  absolutePresets,
  onSelectAbsolute,
  currentSize,
  isPresetDisabled,
}: AspectRatioControlProps) {
  const [open, setOpen] = useState(false);
  const locked = activePreset !== null;

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "inline-flex items-center justify-center gap-0 h-6 shrink-0 rounded-md transition-colors",
              "hover:bg-accent hover:text-accent-foreground",
              "disabled:pointer-events-none disabled:opacity-50",
              locked ? "text-primary px-1" : "text-muted-foreground px-1",
              absolutePresets ? "w-auto min-w-9" : "w-9",
            )}
            title={
              absolutePresets
                ? locked
                  ? `Size: ${activePreset}`
                  : "Select output size"
                : locked
                  ? `Aspect ratio locked to ${activePreset}`
                  : "Select aspect ratio preset"
            }
          >
            {locked ? (
              <span className="text-3xs font-medium leading-none font-mono">{activePreset}</span>
            ) : absolutePresets && currentSize ? (
              <span className="text-3xs font-medium leading-none font-mono">
                {currentSize.w}x{currentSize.h}
              </span>
            ) : (
              <Link2Off size={12} />
            )}
            <ChevronDown size={8} className="ml-0.5 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className={cn("p-1", absolutePresets ? "w-36" : "w-32")}
          align="center"
          sideOffset={6}
        >
          {absolutePresets ? (
            absolutePresets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  onSelectAbsolute?.(p);
                  setOpen(false);
                }}
                className={cn(
                  "w-full text-left text-2xs px-2 py-1 rounded-sm transition-colors font-mono",
                  "hover:bg-accent hover:text-accent-foreground",
                  (activePreset === p.label ||
                    (!activePreset && currentSize?.w === p.w && currentSize?.h === p.h)) &&
                    "text-primary font-medium",
                )}
              >
                {p.label}
              </button>
            ))
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  onSelectPreset(null);
                  setOpen(false);
                }}
                className={cn(
                  "w-full text-left text-2xs px-2 py-1 rounded-sm transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  !locked && "text-primary font-medium",
                )}
              >
                Custom
              </button>
              {presets.map((p) => {
                const unfit = isPresetDisabled?.(p) ?? false;
                return (
                  <button
                    key={p.label}
                    type="button"
                    disabled={unfit}
                    title={unfit ? "Doesn't fit this model's size limits" : undefined}
                    onClick={() => {
                      onSelectPreset(p);
                      setOpen(false);
                    }}
                    className={cn(
                      "w-full text-left text-2xs px-2 py-1 rounded-sm transition-colors",
                      "hover:bg-accent hover:text-accent-foreground",
                      "disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-current",
                      activePreset === p.label && "text-primary font-medium",
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </>
          )}
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onSwap}
        className="text-muted-foreground"
        title="Swap width and height - switch between landscape and portrait"
        disabled={disabled}
      >
        <ArrowLeftRight size={12} />
      </Button>
    </div>
  );
}
