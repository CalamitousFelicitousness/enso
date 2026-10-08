import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ActionReason } from "@/lib/jobs/cardActions";
import { reasonText } from "@/lib/jobs/text";
import { cn } from "@/lib/utils";

interface JobSlotProps {
  label: string;
  icon: LucideIcon;
  /** Why the slot cannot act; null when it can. */
  reason: ActionReason | null;
  /** The card is already doing something. */
  busy?: boolean;
  onAct: () => void;
}

/** One fixed action slot of a job card. A slot that cannot act stays in its
 * place, says why on hover, and says it again when clicked. */
export function JobSlot({ label, icon: Icon, reason, busy = false, onAct }: JobSlotProps) {
  const why = reason ? reasonText(reason) : null;
  return (
    <Button
      size="icon"
      variant="ghost"
      className={cn("h-5 w-5 shrink-0", (why || busy) && "opacity-40")}
      aria-label={label}
      aria-disabled={why || busy ? true : undefined}
      title={why ? `${label}: ${why}` : label}
      onClick={(e) => {
        e.stopPropagation();
        if (why) toast.info(why);
        else if (!busy) onAct();
      }}
    >
      <Icon className="h-2.5 w-2.5" />
    </Button>
  );
}
