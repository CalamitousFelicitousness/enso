import { useState } from "react";
import { Loader2, ExternalLink, Check, AlertCircle } from "lucide-react";
import { useUpdateCheck, useApplyUpdate } from "@/api/hooks/useSystem";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Section, Row } from "../shared";

export function UpdateSubTab() {
  const { data: info, isFetching, refetch } = useUpdateCheck();
  const applyUpdate = useApplyUpdate();
  const [rebase, setRebase] = useState(true);
  const [submodules, setSubmodules] = useState(true);
  const [extensions, setExtensions] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const checkRan = !!info && !info.error;
  const upToDate = checkRan && info.up_to_date;
  const applyDisabled = !checkRan || upToDate || applyUpdate.isPending;
  const applyTitle = !checkRan
    ? "Run a check first"
    : upToDate
      ? "Already up to date"
      : "Apply available updates";

  function handleApply() {
    applyUpdate.mutate(
      { rebase, submodules, extensions },
      {
        onSuccess: (data) => {
          setConfirmOpen(false);
          toast.success(data.changed ? "Update applied" : "No changes");
        },
        onError: (err) => {
          toast.error("Update failed", {
            description: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }

  return (
    <div className="space-y-4">
      <Button size="sm" onClick={() => void refetch()} disabled={isFetching} className="w-full">
        {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
        Check for updates
      </Button>

      {info && !info.error && (
        <Section title="Version Info">
          <Row label="Branch" value={info.branch} />
          <Row label="Current" value={`${info.current_date} (${info.current_hash})`} />

          <Row label="Latest" value={`${info.latest_date} (${info.latest_hash})`} />

          <div className="flex items-center gap-1.5 text-xs mt-1">
            {info.up_to_date ? (
              <>
                <Check className="h-3.5 w-3.5 text-green-500" />

                <span className="text-green-500">Up to date</span>
              </>
            ) : (
              <>
                <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />

                <span className="text-yellow-500">Update available</span>
              </>
            )}
          </div>
          {info.url && (
            <a
              href={info.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-accent hover:underline mt-1"
            >
              <ExternalLink className="h-3 w-3" />
              View on GitHub
            </a>
          )}
        </Section>
      )}

      {info?.error && <p className="text-xs text-destructive">{info.error}</p>}

      <Section title="Download Options">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Checkbox id="rebase" checked={rebase} onCheckedChange={(c) => setRebase(c === true)} />

            <Label htmlFor="rebase" className="text-xs">
              Rebase
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="submodules"
              checked={submodules}
              onCheckedChange={(c) => setSubmodules(c === true)}
            />

            <Label htmlFor="submodules" className="text-xs">
              Submodules
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="extensions"
              checked={extensions}
              onCheckedChange={(c) => setExtensions(c === true)}
            />

            <Label htmlFor="extensions" className="text-xs">
              Extensions
            </Label>
          </div>
        </div>
      </Section>

      <Button
        size="sm"
        onClick={() => setConfirmOpen(true)}
        disabled={applyDisabled}
        title={applyTitle}
        className="w-full"
      >
        Download updates
      </Button>

      {applyUpdate.data && (
        <div className="text-xs space-y-1 p-2 rounded bg-muted">
          <p className="font-medium">
            {applyUpdate.data.changed ? "Update applied" : "No changes"}
          </p>
          <pre className="whitespace-pre-wrap text-muted-foreground text-3xs">
            {applyUpdate.data.status}
          </pre>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Apply update</DialogTitle>
            {info && (
              <DialogDescription>
                Update from <span className="font-mono">{info.current_hash}</span> to{" "}
                <span className="font-mono">{info.latest_hash}</span> on branch{" "}
                <span className="font-mono">{info.branch}</span>.
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="space-y-2 text-xs">
            <p className="text-muted-foreground">The following actions will run:</p>
            <ul className="list-disc pl-5 space-y-1">
              {rebase && (
                <li>
                  <span className="font-medium">Rebase</span> - local changes will be stashed before
                  pulling.
                </li>
              )}
              <li>
                Pull latest commits from <code>origin/{info?.branch ?? "?"}</code>.
              </li>
              {submodules && <li>Reinstall submodules.</li>}
              {extensions && <li>Reinstall extensions.</li>}
            </ul>
            <p className="text-muted-foreground">
              A server restart will be required after the update completes.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmOpen(false)}
              disabled={applyUpdate.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleApply}
              disabled={applyUpdate.isPending}
            >
              {applyUpdate.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              Apply update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
