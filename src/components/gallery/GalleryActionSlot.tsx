import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GalleryAction } from "./galleryActions";

/** A labelled slot for a Gallery action, the same width in every folder and
 * state. One that cannot act stays, says why on hover and again when clicked. */
export function GalleryActionSlot({ action }: { action: GalleryAction }) {
  const { label, icon: Icon, reason, busy, destructive } = action;
  const refused = reason !== null || busy;
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "h-5 w-[5.75rem] justify-center gap-1 px-1.5 text-3xs",
        destructive && !refused && "text-destructive hover:text-destructive",
        refused && "opacity-40",
      )}
      aria-disabled={refused || undefined}
      aria-busy={busy || undefined}
      title={reason ? `${label}: ${reason}` : label}
      onClick={() => {
        if (reason !== null) toast.info(reason);
        else if (!busy) action.run();
      }}
    >
      <Icon size={12} /> {label}
    </Button>
  );
}
