import * as React from "react";
import { CheckIcon, MinusIcon } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function Checkbox({
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

export { Checkbox };
