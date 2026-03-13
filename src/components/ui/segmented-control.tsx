import * as React from "react";
import { cva } from "class-variance-authority";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { motion, LayoutGroup } from "motion/react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string = string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  onActiveClick?: (value: T) => void;
  variant?:
    | "default"
    | "icon-label"
    | "icon-only"
    | "dense"
    | "tabs"
    | "stacked"
    | "neon-wire";
  orientation?: "horizontal" | "vertical";
  animated?: boolean;
  className?: string;
}

const itemVariants = cva(
  // Base
  "relative z-10 inline-flex items-center justify-center text-center cursor-pointer select-none transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "h-6 px-3 text-2xs font-medium uppercase tracking-wider",
        "icon-label":
          "h-6 px-3 gap-1.5 text-2xs font-medium uppercase tracking-wider",
        "icon-only": "h-6 px-2",
        dense:
          "h-5 px-1.5 text-3xs font-medium tracking-wide",
        tabs:
          "h-8 px-3 text-xs font-medium",
        stacked:
          "flex-col gap-0.5 py-2 px-3 text-3xs font-medium uppercase tracking-wider",
        "neon-wire":
          "h-7 px-2.5 text-[0.6875rem] font-medium whitespace-nowrap",
      },
      animated: {
        true: "",
        false: "",
      },
    },
    compoundVariants: [
      // Standard variants: subtle active state
      {
        variant: "default",
        animated: false,
        className:
          "data-[state=on]:bg-primary/15 data-[state=on]:text-primary data-[state=on]:ring-1 data-[state=on]:ring-primary/40",
      },
      {
        variant: "icon-label",
        animated: false,
        className:
          "data-[state=on]:bg-primary/15 data-[state=on]:text-primary data-[state=on]:ring-1 data-[state=on]:ring-primary/40",
      },
      {
        variant: "icon-only",
        animated: false,
        className:
          "data-[state=on]:bg-primary/15 data-[state=on]:text-primary data-[state=on]:ring-1 data-[state=on]:ring-primary/40",
      },
      {
        variant: "dense",
        animated: false,
        className:
          "data-[state=on]:bg-primary/15 data-[state=on]:text-primary data-[state=on]:ring-1 data-[state=on]:ring-primary/40",
      },
      // Tabs + Stacked variants: bolder active state for panel navigation
      {
        variant: "tabs",
        animated: false,
        className:
          "data-[state=on]:bg-primary/25 data-[state=on]:text-primary data-[state=on]:ring-1 data-[state=on]:ring-primary/60",
      },
      {
        variant: "stacked",
        animated: false,
        className:
          "data-[state=on]:bg-primary/25 data-[state=on]:text-primary data-[state=on]:ring-1 data-[state=on]:ring-primary/60",
      },
      // Animated: text only (bg/ring comes from sliding indicator)
      {
        animated: true,
        className: "data-[state=on]:text-primary",
      },
    ],
    defaultVariants: {
      variant: "default",
      animated: false,
    },
  },
);

const springTransition = {
  type: "spring" as const,
  stiffness: 500,
  damping: 35,
  mass: 0.5,
};

const neonGlowStyle = {
  boxShadow:
    "0 0 8px oklch(from var(--primary) l c h / 0.6), 0 0 20px oklch(from var(--primary) l c h / 0.2)",
};

function SegmentedControlInner<T extends string = string>(
  {
    options,
    value,
    onValueChange,
    onActiveClick,
    variant = "default",
    orientation = "horizontal",
    animated = false,
    className,
  }: SegmentedControlProps<T>,
  ref: React.ForwardedRef<HTMLDivElement>,
) {
  const layoutId = React.useId();
  const isNeonWire = variant === "neon-wire";
  const effectiveAnimated = isNeonWire || animated;

  return (
    <LayoutGroup>
      <ToggleGroupPrimitive.Root
        ref={ref}
        type="single"
        value={value}
        onValueChange={(v) => {
          if (v) onValueChange(v as T);
          else onActiveClick?.(value);
        }}
        data-slot="segmented-control"
        data-animated={effectiveAnimated || undefined}
        data-orientation={orientation}
        className={cn(
          isNeonWire
            ? "group/segmented inline-flex border dark:border-white/[0.06] border-black/[0.06] relative rounded-lg"
            : cn(
                "group/segmented inline-grid border border-border bg-muted/40 p-[5px] gap-[3px] relative",
                orientation === "vertical"
                  ? "auto-rows-fr grid-flow-row"
                  : "auto-cols-fr grid-flow-col",
              ),
          className,
        )}
        style={isNeonWire ? undefined : { borderRadius: "var(--control-radius)" }}
      >
        {options.map((option, index) => {
          const isActive = option.value === value;
          const Icon = option.icon;
          const nextIsActive =
            index < options.length - 1 && options[index + 1].value === value;

          return (
            <React.Fragment key={option.value}>
              <ToggleGroupPrimitive.Item
                value={option.value}
                disabled={option.disabled}
                title={variant === "icon-only" ? option.label : undefined}
                aria-label={variant === "icon-only" ? option.label : undefined}
                className={cn(
                  itemVariants({ variant, animated: effectiveAnimated }),
                  isNeonWire
                    ? "text-muted-foreground/60 hover:text-muted-foreground flex-1"
                    : "text-muted-foreground hover:text-foreground/70",
                )}
                style={
                  isNeonWire ? undefined : { borderRadius: "var(--control-inner-radius)" }
                }
              >
                {/* Neon-wire underline indicator */}
                {isNeonWire && effectiveAnimated && isActive && (
                  <motion.div
                    layoutId={layoutId}
                    className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-primary"
                    style={neonGlowStyle}
                    transition={springTransition}
                  />
                )}
                {/* Standard pill indicator */}
                {!isNeonWire && effectiveAnimated && isActive && (
                  <motion.div
                    layoutId={layoutId}
                    className={cn(
                      "absolute inset-0 ring-1",
                      variant === "tabs" || variant === "stacked"
                        ? "bg-primary/25 ring-primary/60"
                        : "bg-primary/15 ring-primary/40",
                    )}
                    style={{ borderRadius: "var(--control-inner-radius)" }}
                    transition={springTransition}
                  />
                )}
                {variant === "stacked" && Icon && (
                  <Icon size={16} className="relative z-10 shrink-0" />
                )}
                {variant !== "stacked" &&
                  variant !== "neon-wire" &&
                  (variant === "icon-label" || variant === "icon-only") &&
                  Icon && (
                    <Icon
                      size={variant === "icon-only" ? 13 : 11}
                      className="relative z-10 shrink-0"
                    />
                  )}
                {variant !== "icon-only" && (
                  <span className="relative z-[1]">{option.label}</span>
                )}
              </ToggleGroupPrimitive.Item>
              {/* Neon-wire separator between items */}
              {isNeonWire &&
                index < options.length - 1 &&
                !isActive &&
                !nextIsActive && (
                  <div className="self-center w-px h-3.5 dark:bg-white/[0.04] bg-black/[0.04] shrink-0" />
                )}
            </React.Fragment>
          );
        })}
      </ToggleGroupPrimitive.Root>
    </LayoutGroup>
  );
}

const SegmentedControl = React.forwardRef(SegmentedControlInner) as <
  T extends string = string,
>(
  props: SegmentedControlProps<T> & React.RefAttributes<HTMLDivElement>,
) => React.ReactElement;

export { SegmentedControl };
