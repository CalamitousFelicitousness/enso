import { cn } from "@/lib/utils";

interface TextToggleProps {
  variant?: "underline";
  label: string;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

function TextToggle({
  label,
  checked,
  onCheckedChange,
  disabled,
  className,
}: TextToggleProps) {
  return (
    <button
      type="button"
      data-slot="text-toggle"
      role="switch"
      aria-checked={!!checked}
      tabIndex={disabled ? -1 : 0}
      className={cn(
        "relative pb-[3px] outline-none cursor-pointer select-none group/toggle",
        "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:rounded-sm",
        disabled && "opacity-50 pointer-events-none",
        className,
      )}
      onClick={() => !disabled && onCheckedChange?.(!checked)}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          if (!disabled) onCheckedChange?.(!checked);
        }
      }}
    >
      <span
        className={cn(
          "text-3xs transition-colors duration-250 ease-out",
          checked ? "text-primary" : "text-muted-foreground/60",
        )}
      >
        {label}
      </span>
      <div
        className={cn(
          "absolute bottom-0 left-0 h-[1.5px] rounded-full transition-all duration-250 ease-out",
          checked
            ? "bg-primary/70 w-full"
            : "bg-transparent w-0 group-hover/toggle:bg-muted-foreground/20 group-hover/toggle:w-full",
        )}
        style={checked ? { boxShadow: "0 0 3px oklch(from var(--primary) l c h / 0.3)" } : undefined}
      />
    </button>
  );
}

export { TextToggle };
export type { TextToggleProps };
