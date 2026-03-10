"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function Switch({
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

export { Switch };
