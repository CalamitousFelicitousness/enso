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
  variant?: "default" | "icon-label" | "icon-only" | "dense";
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
      },
      animated: {
        true: "",
        false: "",
      },
    },
    compoundVariants: [
      {
        animated: false,
        className:
          "data-[state=on]:bg-primary/15 data-[state=on]:text-primary data-[state=on]:ring-1 data-[state=on]:ring-primary/40",
      },
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

function SegmentedControlInner<T extends string = string>(
  {
    options,
    value,
    onValueChange,
    variant = "default",
    animated = false,
    className,
  }: SegmentedControlProps<T>,
  ref: React.ForwardedRef<HTMLDivElement>,
) {
  const layoutId = React.useId();

  return (
    <LayoutGroup>
      <ToggleGroupPrimitive.Root
        ref={ref}
        type="single"
        value={value}
        onValueChange={(v) => {
          if (v) onValueChange(v as T);
        }}
        data-slot="segmented-control"
        data-animated={animated || undefined}
        className={cn(
          "group/segmented inline-grid auto-cols-fr grid-flow-col border border-border bg-muted/40 p-[5px] gap-[3px] relative",
          className,
        )}
        style={{ borderRadius: "var(--control-radius)" }}
      >
        {options.map((option) => {
          const isActive = option.value === value;
          const Icon = option.icon;

          return (
            <ToggleGroupPrimitive.Item
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              title={variant === "icon-only" ? option.label : undefined}
              aria-label={variant === "icon-only" ? option.label : undefined}
              className={cn(
                itemVariants({ variant, animated }),
                "text-muted-foreground hover:text-foreground/70",
              )}
              style={{ borderRadius: "var(--control-inner-radius)" }}
            >
              {animated && isActive && (
                <motion.div
                  layoutId={layoutId}
                  className="absolute inset-0 bg-primary/15 ring-1 ring-primary/40"
                  style={{ borderRadius: "var(--control-inner-radius)" }}
                  transition={springTransition}
                />
              )}
              {(variant === "icon-label" || variant === "icon-only") &&
                Icon && (
                  <Icon
                    size={variant === "icon-only" ? 13 : 11}
                    className="relative z-10 shrink-0"
                  />
                )}
              {variant !== "icon-only" && (
                <span className="relative z-10">{option.label}</span>
              )}
            </ToggleGroupPrimitive.Item>
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
