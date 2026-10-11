import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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

/** A slot's label, with its reason or note as a second line; `reserve`
 * keeps that line's height when there is nothing to say. */
export function SlotRow({
  icon: Icon,
  label,
  reason,
  note = null,
  reserve = false,
}: SlotWords & { icon: LucideIcon; label: string; reserve?: boolean }) {
  const line = reason ?? note;
  return (
    <>
      <Icon size={14} className="shrink-0" />
      <span className="flex min-w-0 flex-col text-left">
        <span className={cn(reserve && "truncate leading-tight")}>{label}</span>
        {(line || reserve) && (
          <span
            className={cn(
              "text-3xs leading-tight text-muted-foreground",
              reserve && "min-h-[1lh] truncate",
            )}
          >
            {line}
          </span>
        )}
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
  silent = false,
  className,
  onAct,
}: Partial<SlotWords> & {
  icon: LucideIcon;
  label: string;
  /** The slot's action is already under way. */
  busy?: boolean;
  /** A label above already says the slot's words. */
  silent?: boolean;
  className?: string;
  onAct: () => void;
}) {
  const refused = reason !== null || busy;
  return (
    <ContextMenuItem
      aria-disabled={refused || undefined}
      className={cn(className, refused && "opacity-50")}
      onSelect={() => {
        if (reason !== null) {
          if (!quiet) toast.info(reason);
        } else if (!busy) onAct();
      }}
    >
      <SlotRow
        icon={icon}
        label={label}
        reason={silent ? null : reason}
        note={silent ? null : note}
      />
    </ContextMenuItem>
  );
}

/** A slot as a full-width button in a list, its words on a second line kept
 * even when empty, so the list holds its height whatever the slots say.
 * `silent` leaves the words to a line above that already says them;
 * `compact` is one line in a bar, its words in its title. */
export function SlotButton({
  icon: Icon,
  label,
  reason = null,
  quiet = false,
  note = null,
  busy = false,
  silent = false,
  compact = false,
  onAct,
}: Partial<SlotWords> & {
  icon: LucideIcon;
  label: string;
  busy?: boolean;
  silent?: boolean;
  compact?: boolean;
  onAct: () => void;
}) {
  const refused = reason !== null || busy;
  const words = reason ?? note;
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn(
        compact ? "gap-1.5 text-2xs" : "h-auto w-full justify-start gap-2 py-1 text-2xs",
        refused && "opacity-50",
      )}
      aria-disabled={refused || undefined}
      title={words ? `${label}: ${words}` : label}
      onClick={() => {
        if (reason !== null) {
          if (!quiet) toast.info(reason);
        } else if (!busy) onAct();
      }}
    >
      {compact ? (
        <>
          <Icon size={14} />
          {label}
        </>
      ) : (
        <SlotRow
          icon={Icon}
          label={label}
          reason={silent ? null : reason}
          note={silent ? null : note}
          reserve
        />
      )}
    </Button>
  );
}
