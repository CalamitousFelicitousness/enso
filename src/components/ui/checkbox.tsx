import * as React from "react";
import { CheckIcon, MinusIcon } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

// --- Default variant (existing Radix implementation) ---

function CheckboxDefault({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-3.5 shrink-0 rounded-sm border outline-none transition-all duration-200",
        "flex items-center justify-center",
        // Unchecked: muted surface with border
        "bg-muted border-border text-transparent",
        "hover:border-border-hover group-hover:border-border-hover",
        // Checked / indeterminate: soft primary fill with border + ring glow
        "data-[state=checked]:bg-primary/15 data-[state=checked]:text-primary data-[state=checked]:border-primary/40 data-[state=checked]:ring-1 data-[state=checked]:ring-primary/40",
        "data-[state=indeterminate]:bg-primary/15 data-[state=indeterminate]:text-primary data-[state=indeterminate]:border-primary/40 data-[state=indeterminate]:ring-1 data-[state=indeterminate]:ring-primary/40",
        // Focus
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        // Disabled
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current"
      >
        <CheckIcon className="size-2.5 hidden [[data-state=checked]_&]:block" strokeWidth={2} />
        <MinusIcon className="size-2.5 hidden [[data-state=indeterminate]_&]:block" strokeWidth={2} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

// --- Morph variant (X/check SVG morph) ---

function CheckboxMorph({
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-slot="checkbox"
      role="checkbox"
      aria-checked={!!checked}
      tabIndex={disabled ? -1 : 0}
      className={cn(
        "size-4 rounded-[3px] ring-1 outline-none transition-all duration-250 flex items-center justify-center",
        "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        checked
          ? "bg-primary/15 ring-primary/40"
          : "bg-muted/30 ring-border/20",
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
      <div className="relative size-2.5">
        {/* Check mark */}
        <svg
          viewBox="0 0 10 10"
          className={cn(
            "absolute inset-0 size-full transition-all duration-250",
            checked ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-50 rotate-90",
          )}
          style={{ stroke: "oklch(from var(--primary) l c h)" }}
        >
          <path d="M2 5.5L4 7.5L8 3" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {/* X mark */}
        <svg
          viewBox="0 0 10 10"
          className={cn(
            "absolute inset-0 size-full transition-all duration-250",
            !checked ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-50 -rotate-90",
          )}
          style={{ stroke: "oklch(from var(--muted-foreground) l c h / 0.35)" }}
        >
          <path d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5" fill="none" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    </button>
  );
}

// --- Stamp variant (pressure plate) ---

function CheckboxStamp({
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [pressing, setPressing] = React.useState(false);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout>>(null);

  const handleClick = () => {
    if (disabled) return;
    setPressing(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setPressing(false), 150);
    onCheckedChange?.(!checked);
  };

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <button
      type="button"
      data-slot="checkbox"
      role="checkbox"
      aria-checked={!!checked}
      tabIndex={disabled ? -1 : 0}
      className={cn(
        "size-4 rounded-[3px] ring-1 outline-none flex items-center justify-center transition-all duration-150",
        "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        checked
          ? "bg-primary/10 ring-primary/30"
          : "bg-muted/30 ring-border/20",
        pressing && "scale-90",
        disabled && "opacity-50 pointer-events-none",
        className,
      )}
      style={checked ? { boxShadow: "inset 0 1px 2px oklch(from var(--primary) l c h / 0.15)" } : undefined}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <div
        className={cn(
          "rounded-full transition-all duration-150",
          checked ? "size-1.5 bg-primary" : "size-1 bg-muted-foreground/15",
        )}
        style={checked ? { boxShadow: "0 0 4px oklch(from var(--primary) l c h / 0.4)" } : undefined}
      />
    </button>
  );
}

// --- Bracket variant ([ ] with fill bar) ---

function CheckboxBracket({
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-slot="checkbox"
      role="checkbox"
      aria-checked={!!checked}
      tabIndex={disabled ? -1 : 0}
      className={cn(
        "h-4 shrink-0 inline-flex items-center gap-0 outline-none cursor-pointer select-none",
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
          "font-mono text-[11px] leading-none transition-all duration-200",
          checked ? "text-primary/60" : "text-muted-foreground/30",
        )}
        style={{
          transform: checked ? "translateX(-1px)" : "translateX(0)",
          transitionTimingFunction: "cubic-bezier(0.34, 1.2, 0.64, 1)",
        }}
      >
        [
      </span>
      <div
        className={cn(
          "h-[6px] rounded-[1px] transition-all duration-200",
          checked ? "bg-primary/60" : "bg-muted-foreground/8",
        )}
        style={{
          width: checked ? 10 : 4,
          boxShadow: checked ? "0 0 4px oklch(from var(--primary) l c h / 0.3)" : "none",
          transitionTimingFunction: "cubic-bezier(0.34, 1.2, 0.64, 1)",
        }}
      />
      <span
        className={cn(
          "font-mono text-[11px] leading-none transition-all duration-200",
          checked ? "text-primary/60" : "text-muted-foreground/30",
        )}
        style={{
          transform: checked ? "translateX(1px)" : "translateX(0)",
          transitionTimingFunction: "cubic-bezier(0.34, 1.2, 0.64, 1)",
        }}
      >
        ]
      </span>
    </button>
  );
}

// --- Main Checkbox component ---

function Checkbox({
  variant = "default",
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root> & {
  variant?: "default" | "morph" | "stamp" | "bracket";
}) {
  if (variant === "morph") {
    return (
      <CheckboxMorph
        checked={props.checked === true}
        onCheckedChange={props.onCheckedChange as (checked: boolean) => void}
        disabled={props.disabled}
        className={className}
      />
    );
  }

  if (variant === "stamp") {
    return (
      <CheckboxStamp
        checked={props.checked === true}
        onCheckedChange={props.onCheckedChange as (checked: boolean) => void}
        disabled={props.disabled}
        className={className}
      />
    );
  }

  if (variant === "bracket") {
    return (
      <CheckboxBracket
        checked={props.checked === true}
        onCheckedChange={props.onCheckedChange as (checked: boolean) => void}
        disabled={props.disabled}
        className={className}
      />
    );
  }

  return <CheckboxDefault className={className} {...props} />;
}

export { Checkbox };
