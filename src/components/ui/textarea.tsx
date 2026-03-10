import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input placeholder:text-muted-foreground/40 hover:border-border-hover focus-visible:border-primary/50 focus-visible:ring-primary/20 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive bg-muted/30 flex field-sizing-content min-h-16 w-full min-w-0 rounded-md border px-2.5 py-2 text-2xs transition-[color,box-shadow] outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
