import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

/** A slot's words: why it cannot act, or how it will. */
export interface SlotWords {
  /** Why the slot cannot act; null when it can. */
  reason: string | null;
  /** The reason passes by itself, such as a record still being read: choosing
   * the slot says nothing. */
  quiet?: boolean;
  /** How the slot will act, when that is worth knowing before it does. */
  note?: string | null;
}

/** A slot's label, with its reason or note as a second line. */
export function SlotRow({
  icon: Icon,
  label,
  reason,
  note = null,
}: SlotWords & { icon: LucideIcon; label: string }) {
  const line = reason ?? note;
  return (
    <>
      <Icon size={14} />
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {line && <span className="text-3xs leading-tight text-muted-foreground">{line}</span>}
      </span>
    </>
  );
}

/** A menu item for a slot. One that cannot act stays in its place and in the
 * focus order, dimmed, and says why when chosen; one that can acts. */
export function SlotMenuItem({
  icon,
  label,
  reason = null,
  quiet = false,
  note = null,
  busy = false,
  onAct,
}: Partial<SlotWords> & {
  icon: LucideIcon;
  label: string;
  /** The slot's action is already under way. */
  busy?: boolean;
  onAct: () => void;
}) {
  const refused = reason !== null || busy;
  return (
    <ContextMenuItem
      aria-disabled={refused || undefined}
      className={cn("text-2xs", refused && "opacity-50")}
      onSelect={() => {
        if (reason !== null) {
          if (!quiet) toast.info(reason);
        } else if (!busy) onAct();
      }}
    >
      <SlotRow icon={icon} label={label} reason={reason} note={note} />
    </ContextMenuItem>
  );
}
