"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

// --- Fill bar constants (shared with ParamSlider) ---

const fillGradient = `linear-gradient(to right, oklch(from var(--primary) l c h / 0.08), oklch(from var(--primary) l c h / 0.20) 70%, oklch(from var(--primary) l c h / 0.28))`;
const fillEdgeGlow = `inset -1px 0 0 0 oklch(from var(--primary) l c h / 0.6), inset -4px 0 6px -3px oklch(from var(--primary) l c h / 0.2)`;

// --- Pill variant (existing Radix implementation) ---

function SwitchPill({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer data-[state=checked]:bg-primary/20 data-[state=unchecked]:bg-muted focus-visible:border-ring focus-visible:ring-ring/50 group/switch inline-flex shrink-0 items-center rounded-md border transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-4 data-[size=default]:w-7 data-[size=sm]:h-3.5 data-[size=sm]:w-6",
        "data-[state=unchecked]:border-border data-[state=unchecked]:hover:border-border-hover data-[state=unchecked]:group-hover:border-border-hover",
        "data-[state=checked]:border-primary/40",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted-foreground/50 pointer-events-none block rounded-sm ring-0 transition-transform group-data-[size=default]/switch:size-2.5 group-data-[size=sm]/switch:size-2 group-data-[size=default]/switch:data-[state=checked]:translate-x-3.5 group-data-[size=sm]/switch:data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0.5",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

// --- Track variant (ParamSlider-style fill bar) ---

function SwitchTrack({
  checked,
  onCheckedChange,
  disabled,
  label,
  className,
}: {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <div
      data-slot="switch"
      role="switch"
      aria-checked={!!checked}
      tabIndex={disabled ? -1 : 0}
      className={cn(
        "relative h-5 rounded-sm bg-muted/60 overflow-hidden cursor-pointer select-none outline-none",
        "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
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
      <div
        className="absolute inset-y-0 left-0 rounded-sm transition-[width,box-shadow] duration-200 ease-out"
        style={{
          width: checked ? "100%" : "0%",
          background: fillGradient,
          boxShadow: checked ? fillEdgeGlow : "none",
        }}
      />
      {label && (
        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-3xs text-muted-foreground pointer-events-none">
          {label}
        </span>
      )}
      <span className="absolute right-1.5 top-1/2 -translate-y-1/2 font-mono text-3xs uppercase tracking-wider pointer-events-none text-muted-foreground">
        {checked ? "on" : "off"}
      </span>
    </div>
  );
}

// --- Split variant (segmented OFF|ON) ---

function SwitchSplit({
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
    <div
      data-slot="switch"
      role="switch"
      aria-checked={!!checked}
      tabIndex={disabled ? -1 : 0}
      className={cn(
        "h-[18px] rounded-sm ring-1 ring-border/25 inline-flex items-center overflow-hidden cursor-pointer select-none outline-none",
        "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        disabled && "opacity-50 pointer-events-none",
        className,
      )}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          if (!disabled) onCheckedChange?.(!checked);
        }
      }}
    >
      <button
        type="button"
        tabIndex={-1}
        className={cn(
          "font-mono text-[8px] uppercase tracking-wider px-2.5 h-full flex items-center transition-colors duration-200",
          !checked ? "bg-primary/15 text-primary/80" : "text-muted-foreground/30",
        )}
        onClick={() => !disabled && onCheckedChange?.(false)}
      >
        off
      </button>
      <div className="w-px h-full bg-border/25" />
      <button
        type="button"
        tabIndex={-1}
        className={cn(
          "font-mono text-[8px] uppercase tracking-wider px-2.5 h-full flex items-center transition-colors duration-200",
          checked ? "bg-primary/15 text-primary/80" : "text-muted-foreground/30",
        )}
        onClick={() => !disabled && onCheckedChange?.(true)}
      >
        on
      </button>
    </div>
  );
}

// --- Main Switch component ---

function Switch({
  variant = "pill",
  label,
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  variant?: "pill" | "track" | "split";
  size?: "sm" | "default";
  label?: string;
}) {
  if (variant === "track") {
    return (
      <SwitchTrack
        checked={props.checked}
        onCheckedChange={props.onCheckedChange}
        disabled={props.disabled}
        label={label}
        className={className}
      />
    );
  }

  if (variant === "split") {
    return (
      <SwitchSplit
        checked={props.checked}
        onCheckedChange={props.onCheckedChange}
        disabled={props.disabled}
        className={className}
      />
    );
  }

  return <SwitchPill className={className} size={size} {...props} />;
}

export { Switch };
