import { useState } from "react";
import { Focus, Maximize } from "lucide-react";
import { SegmentedControl, type SegmentOption } from "@/components/ui/segmented-control";
import { CANVAS_TIP, FOCUS_TIP } from "@/canvas/navigation/text";

type Mode = "focus" | "canvas";

const OPTIONS: SegmentOption<Mode>[] = [
  { value: "focus", label: "Focus", icon: Focus, title: FOCUS_TIP },
  { value: "canvas", label: "Canvas", icon: Maximize, title: CANVAS_TIP },
];

interface ModeToggleProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  /** Counts the moves that left Focus mode; each one flashes the pill. */
  flips: number;
}

export function ModeToggle({ mode, onModeChange, flips }: ModeToggleProps) {
  const [mounted] = useState(flips);
  return (
    <div className="relative">
      <SegmentedControl
        options={OPTIONS}
        value={mode}
        onValueChange={onModeChange}
        variant="icon-label"
        animated
        className="p-0.5 gap-0.5 dark:bg-popover/80 bg-popover/70 backdrop-blur-xl border-border/50 ring-1 dark:ring-white/[0.05] ring-black/[0.05] shadow-lg shadow-black/20"
      />
      {/* A new element per flip restarts the flash */}
      {flips !== mounted && (
        <span
          key={flips}
          aria-hidden
          className="mode-flipped pointer-events-none absolute inset-0"
          style={{ borderRadius: "var(--control-radius)" }}
        />
      )}
    </div>
  );
}
