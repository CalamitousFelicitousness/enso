import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { HISTORY_LOSES, RESULTS_KEPT } from "@/lib/jobs/text";

interface HistoryBulkDeleteDialogProps {
  open: boolean;
  count: number;
  scope: string;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function HistoryBulkDeleteDialog({
  open,
  count,
  scope,
  isPending,
  onConfirm,
  onCancel,
}: HistoryBulkDeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 size={18} className="text-destructive" />
            Delete {count} {count === 1 ? "job" : "jobs"}
          </DialogTitle>
          <DialogDescription>
            This removes {scope} from the server's job history. {HISTORY_LOSES} {RESULTS_KEPT}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
