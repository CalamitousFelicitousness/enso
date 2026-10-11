import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ActionSlotProps {
  label: string;
  icon: LucideIcon;
  /** Why the slot cannot act, worded for the user; null when it can. */
  reason: string | null;
  /** The reason passes by itself, such as a record still being read: a click
   * says nothing. */
  quiet?: boolean;
  /** How the slot will act, when that is worth knowing before it does. */
  note?: string | null;
  /** The card is already doing something. */
  busy?: boolean;
  /** -1 when the slot is reached by its card's keys instead of Tab. */
  tabIndex?: number;
  onAct: () => void;
}

/** One fixed action slot of a card or row. A slot that cannot act stays in
 * its place, says why on hover, and says it again when clicked; one that acts
 * in a way worth knowing says how on hover. */
export function ActionSlot({
  label,
  icon: Icon,
  reason,
  quiet = false,
  note = null,
  busy = false,
  tabIndex,
  onAct,
}: ActionSlotProps) {
  return (
    <Button
      size="icon"
      variant="ghost"
      className={cn("h-5 w-5 shrink-0", (reason || busy) && "opacity-40")}
      aria-label={label}
      aria-disabled={reason || busy ? true : undefined}
      title={reason ? `${label}: ${reason}` : note ? `${label}: ${note}` : label}
      tabIndex={tabIndex}
      onClick={(e) => {
        e.stopPropagation();
        if (reason) {
          if (!quiet) toast.info(reason);
        } else if (!busy) onAct();
      }}
    >
      <Icon className="h-2.5 w-2.5" />
    </Button>
  );
}
