import { useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { clearSubmitProgress, setBatchProgress } from "@/inputs/progress";
import { newSubmitId, post, prepare, type Prepared, type Submission } from "@/inputs/submit";
import { UploadBatch } from "@/inputs/uploads";
import { retryable } from "@/hooks/useSubmitToQueue";
import { UserAbortError } from "@/lib/abort";
import { RETRY } from "@/lib/media/text";
import type { JobRequest } from "@/api/types/v2";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface BatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  build: (batch: UploadBatch) => Promise<Submission>;
}

/** Names the batch's uploads in the progress the Generate button shows. */
const ACTION = "images";

export function BatchDialog({ open, onOpenChange, build }: BatchDialogProps) {
  const [count, setCount] = useState(4);
  const [baseSeed, setBaseSeed] = useState(-1);
  const [autoSeed, setAutoSeed] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /** Post the jobs from `from` on, each under its own id, which its Retry sends again. */
  const postFrom = useCallback(
    async (prepared: Prepared, ids: readonly string[], base: number, from: number) => {
      setIsSubmitting(true);
      let current = prepared;
      let i = from;
      try {
        for (; i < ids.length; i++) {
          const request = { ...current.request, seed: base + i } as JobRequest;
          current = (await post({ ...current, request }, ids[i] ?? newSubmitId())).prepared;
        }
        toast.success(`Queued ${ids.length} jobs`, {
          description: `Seeds ${base}-${base + ids.length - 1}`,
        });
        onOpenChange(false);
      } catch (err) {
        const failedAt = i;
        toast.error(`Queued ${failedAt} of ${ids.length} jobs`, {
          description: err instanceof Error ? err.message : String(err),
          ...(retryable(err)
            ? {
                action: {
                  label: RETRY,
                  onClick: () => void postFrom(current, ids, base, failedAt),
                },
              }
            : {}),
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [onOpenChange],
  );

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    let prepared: Prepared;
    try {
      // One build and one set of uploads: every job of the batch sends them with its own seed
      const batch = new UploadBatch("batch", { onProgress: (p) => setBatchProgress(ACTION, p) });
      prepared = await prepare(await build(batch));
    } catch (err) {
      setIsSubmitting(false);
      if (err instanceof UserAbortError) return;
      toast.error("Failed to submit batch", {
        description: err instanceof Error ? err.message : String(err),
      });
      return;
    } finally {
      clearSubmitProgress(ACTION);
    }
    const base = autoSeed ? Math.floor(Math.random() * 999999999) : baseSeed;
    const ids = Array.from({ length: count }, newSubmitId);
    await postFrom(prepared, ids, base, 0);
  }, [build, count, baseSeed, autoSeed, postFrom]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Batch Generation</DialogTitle>
          <DialogDescription>Submit multiple jobs with sequential seeds.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="batch-count" className="text-xs">
              Number of jobs
            </Label>
            <Input
              id="batch-count"
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
              className="h-8"
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="auto-seed" className="text-xs">
              Random base seed
            </Label>
            <Switch id="auto-seed" checked={autoSeed} onCheckedChange={setAutoSeed} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="base-seed" className="text-xs">
              Base seed
            </Label>
            <Input
              id="base-seed"
              type="number"
              min={0}
              max={999999999}
              value={baseSeed}
              onChange={(e) => setBaseSeed(Number(e.target.value) || 0)}
              className="h-8"
              disabled={autoSeed}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void handleSubmit()} disabled={isSubmitting}>
            {isSubmitting && <Loader2 size={14} className="animate-spin mr-1" />}
            Submit {count} Jobs
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
