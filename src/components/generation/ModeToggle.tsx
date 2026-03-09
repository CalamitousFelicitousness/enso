import { Lock, Unlock, Focus, Maximize } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModeToggleProps {
  mode: "focus" | "canvas";
  onModeChange: (mode: "focus" | "canvas") => void;
  locked: boolean;
  onLockedChange: (locked: boolean) => void;
}

export function ModeToggle({ mode, onModeChange, locked, onLockedChange }: ModeToggleProps) {
  const isFocus = mode === "focus";

  return (
    <div
      className={cn(
        "relative flex items-center h-6 rounded-full overflow-hidden",
        "dark:bg-popover/80 bg-popover/70 backdrop-blur-xl",
        "ring-1 dark:ring-white/[0.05] ring-black/[0.05]",
        "border border-border/50 shadow-lg shadow-black/20",
      )}
    >
      {/* Sliding highlight */}
      <div
        className={cn(
          "absolute inset-y-[2px] left-[2px] rounded-full",
          "w-[calc(50%-4px)]",
          "bg-primary/20 border border-primary/40",
          "transition-all duration-150 ease-out",
          !isFocus && "translate-x-[calc(100%+4px)]",
        )}
      />

      {/* Focus */}
      <button
        type="button"
        onClick={() => onModeChange("focus")}
        className={cn(
          "relative z-10 flex items-center justify-center gap-1 h-full",
          "text-2xs font-medium uppercase tracking-wider",
          "transition-colors duration-150 cursor-pointer select-none",
          "w-1/2",
          isFocus
            ? "text-primary"
            : "text-muted-foreground hover:text-foreground/70",
        )}
      >
        <Focus size={10} />
        Focus
      </button>

      {/* Canvas */}
      <button
        type="button"
        onClick={() => onModeChange("canvas")}
        className={cn(
          "relative z-10 flex items-center justify-center gap-1 h-full",
          "text-2xs font-medium uppercase tracking-wider",
          "transition-colors duration-150 cursor-pointer select-none",
          "w-1/2",
          !isFocus
            ? "text-primary"
            : "text-muted-foreground hover:text-foreground/70",
        )}
      >
        <Maximize size={10} />
        Canvas
      </button>

      {/* Lock — absolutely positioned over the centre join */}
      <button
        type="button"
        onClick={() => onLockedChange(!locked)}
        title={locked ? "Unlock mode switching" : "Lock current mode"}
        className={cn(
          "absolute z-20 left-1/2 -translate-x-1/2",
          "flex items-center justify-center w-4 h-4 rounded-full",
          "transition-colors duration-150 cursor-pointer",
          "dark:bg-popover bg-popover border border-border/60",
          locked
            ? "text-primary"
            : "text-muted-foreground/50 hover:text-muted-foreground",
        )}
      >
        {locked ? <Lock size={8} /> : <Unlock size={8} />}
      </button>
    </div>
  );
}
