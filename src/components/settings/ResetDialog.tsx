import { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useShortcutScope } from "@/hooks/useShortcutScope";
import { gateLine, gateRefuses } from "@/lib/profile/gate";
import type { ResetRow } from "@/lib/profile/manifest";
import { clearsContent, DEFAULT_ROWS, shownRows } from "@/lib/profile/rows";
import {
  CHOOSE_ROWS,
  FETCHED_AGAIN,
  REQUEST_REFUSED,
  RESET_DESCRIPTION,
  RESET_LABEL,
  RESET_TITLE,
  ROW_NAMES,
  rowDetail,
  STAYS,
} from "@/lib/profile/text";
import { cn } from "@/lib/utils";
import { useResetGate } from "@/profile/gate";
import { useProfileMeasure } from "@/profile/measure";
import { requestReset } from "@/profile/request";
import { useResetDialogStore } from "@/stores/resetDialogStore";

/** The one place a reset is asked for: the Settings section, the Help menu
 * and the palette all open it. */
export function ResetDialogHost() {
  const open = useResetDialogStore((s) => s.open);
  const opened = useResetDialogStore((s) => s.opened);
  const close = useResetDialogStore((s) => s.close);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <ResetDialogContent key={opened} open={open} onCancel={close} />
    </Dialog>
  );
}

function ResetDialogContent({ open, onCancel }: { open: boolean; onCancel: () => void }) {
  const id = useId();
  const [chosen, setChosen] = useState<ReadonlySet<ResetRow>>(() => new Set(DEFAULT_ROWS));
  const [running, setRunning] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const measure = useProfileMeasure(open);
  const gate = useResetGate(open);
  useShortcutScope("dialog", open);

  const rows = shownRows(measure);
  const asked = rows.filter((row) => chosen.has(row));
  const refuses = gate !== null && gateRefuses(gate);
  const reason =
    asked.length === 0 ? CHOOSE_ROWS : (refused ?? (gate === null ? null : gateLine(gate)));
  const disabled = running || asked.length === 0 || gate === null || refuses;

  const toggle = (row: ResetRow, on: boolean) => {
    setRefused(null);
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(row);
      else next.delete(row);
      return next;
    });
  };

  const submit = async () => {
    setRunning(true);
    setRefused(null);
    const refusal = await requestReset(asked);
    setRunning(false);
    setRefused(refusal.kind === "unstored" ? REQUEST_REFUSED : gateLine(refusal.gate));
  };

  const hold = (e: Event) => {
    if (running) e.preventDefault();
  };

  return (
    <DialogContent
      className="sm:max-w-md"
      showCloseButton={false}
      onEscapeKeyDown={hold}
      onPointerDownOutside={hold}
      onInteractOutside={hold}
    >
      <DialogHeader>
        <DialogTitle>{RESET_TITLE}</DialogTitle>
        <DialogDescription>{RESET_DESCRIPTION}</DialogDescription>
      </DialogHeader>

      <div className="space-y-2.5">
        {rows.map((row) => (
          <div key={row} className="flex items-start gap-2">
            <Checkbox
              id={`${id}-${row}`}
              className="mt-0.5"
              checked={chosen.has(row)}
              disabled={running}
              aria-describedby={`${id}-${row}-detail`}
              onCheckedChange={(v) => toggle(row, v === true)}
            />
            <div className="min-w-0 space-y-0.5">
              <Label htmlFor={`${id}-${row}`} className="text-xs font-medium text-foreground">
                {ROW_NAMES[row]}
              </Label>
              <p id={`${id}-${row}-detail`} className="text-2xs text-muted-foreground">
                {rowDetail(row, measure)}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-0.5 text-2xs text-muted-foreground">
        <p>{STAYS}</p>
        <p
          className={cn(!clearsContent(chosen) && "invisible")}
          aria-hidden={!clearsContent(chosen)}
        >
          {FETCHED_AGAIN}
        </p>
      </div>

      <DialogFooter className="items-center sm:justify-between">
        <p
          role="status"
          className={cn(
            "min-h-[1lh] text-2xs",
            asked.length === 0 || refuses || refused ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {reason}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={onCancel} disabled={running}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="w-20"
            disabled={disabled}
            onClick={() => void submit()}
          >
            {running ? <Loader2 className="animate-spin" aria-label={RESET_LABEL} /> : RESET_LABEL}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}
