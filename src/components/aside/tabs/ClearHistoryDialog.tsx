import { Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useJobStats } from "@/api/hooks/useJobs";
import {
  clearHistoryTitle,
  fromThisBrowserText,
  HISTORY_LOSES,
  RESULTS_KEPT,
} from "@/lib/jobs/text";

interface ClearHistoryDialogProps {
  open: boolean;
  /** The finished jobs this page lists. */
  here: number;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Before every finished job leaves the server, the server's count of them,
 * read when the dialog opens: the page lists only its own. */
export function ClearHistoryDialog({
  open,
  here,
  isPending,
  onConfirm,
  onCancel,
}: ClearHistoryDialogProps) {
  const stats = useJobStats(open);
  const counts = stats.data?.counts;
  const finished = counts
    ? (counts.completed ?? 0) + (counts.failed ?? 0) + (counts.cancelled ?? 0)
    : null;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 size={18} className="text-destructive" />
            {clearHistoryTitle(finished)}
          </DialogTitle>
          <DialogDescription>
            {[fromThisBrowserText(here), HISTORY_LOSES, RESULTS_KEPT].filter(Boolean).join(" ")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending || stats.isPending}>
            {isPending ? "Removing..." : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
