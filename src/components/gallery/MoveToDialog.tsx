import { useState } from "react";
import { useBrowserFolders } from "@/api/hooks/useGallery";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { restoreToTitle } from "@/lib/gallery/text";
import { FolderInput, FolderOpen, FolderOutput, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface MoveToDialogProps {
  open: boolean;
  /** Move files between folders, or bring files out of the trash into one. */
  mode: "move" | "restore";
  count: number;
  isPending: boolean;
  onConfirm: (destination: string) => void;
  onCancel: () => void;
}

export function MoveToDialog({
  open,
  mode,
  count,
  isPending,
  onConfirm,
  onCancel,
}: MoveToDialogProps) {
  const { data: folders, isLoading } = useBrowserFolders();
  const [selected, setSelected] = useState<string | null>(null);
  const restoring = mode === "restore";
  const Icon = restoring ? FolderOutput : FolderInput;

  const handleConfirm = () => {
    if (selected) onConfirm(selected);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !isPending && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon size={18} />
            {restoring ? restoreToTitle(count) : `Move ${count} ${count === 1 ? "file" : "files"}`}
          </DialogTitle>
          <DialogDescription>Select a destination folder.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-64 border rounded-md">
          <div className="p-1.5 space-y-0.5">
            {isLoading && (
              <div className="flex items-center justify-center py-4 text-muted-foreground gap-2">
                <Loader2 size={14} className="animate-spin" />

                <span className="text-xs">Loading folders...</span>
              </div>
            )}
            {folders?.map((f) => (
              <button
                key={f.path}
                // a kept folder takes no files; it says why instead
                aria-disabled={f.kept ? true : undefined}
                title={f.kept ?? f.path}
                onClick={() => !f.kept && setSelected(f.path)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left text-sm transition-colors",
                  f.kept
                    ? "cursor-default text-muted-foreground opacity-50 border border-transparent"
                    : selected === f.path
                      ? "bg-primary/10 text-primary border border-primary/30"
                      : "hover:bg-accent text-foreground border border-transparent",
                )}
              >
                <FolderOpen size={14} className="flex-shrink-0 text-muted-foreground" />

                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{f.label}</span>
                  {f.kept && <span className="truncate text-3xs leading-tight">{f.kept}</span>}
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isPending || !selected}>
            {restoring
              ? isPending
                ? "Restoring..."
                : "Restore"
              : isPending
                ? "Moving..."
                : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
