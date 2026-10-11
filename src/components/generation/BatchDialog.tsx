import { useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { RunContext } from "@/inputs/action";
import { newSubmitId, post, prepare, type Prepared, type Submission } from "@/inputs/submit";
import type { UploadBatch } from "@/inputs/uploads";
import { retryable } from "@/hooks/useSubmitToQueue";
import { useUploadAction } from "@/hooks/useUploadAction";
import { ACTIONS } from "@/lib/media/progress";
import { RETRY, UPLOAD_CANCELLED, WAIT_FOR_UPLOAD } from "@/lib/media/text";
import { useActionProgress } from "@/hooks/useActionProgress";
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

const FAILED = "Failed to submit batch";

type Run = ReturnType<typeof useUploadAction>["run"];

/** The jobs of one batch: each posted under its own id, which its Retry sends again. */
interface Jobs {
  run: Run;
  ids: readonly string[];
  base: number;
  done: () => void;
}

/** Post the jobs from `from` on, once their uploads are on the server. */
async function postFrom(ctx: RunContext, jobs: Jobs, prepared: Prepared, from: number) {
  ctx.commit();
  ctx.phase("sending");
  let current = prepared;
  let i = from;
  try {
    for (; i < jobs.ids.length; i++) {
      const request = { ...current.request, seed: jobs.base + i } as JobRequest;
      current = (await post({ ...current, request }, jobs.ids[i] ?? newSubmitId())).prepared;
    }
    toast.success(`Queued ${jobs.ids.length} jobs`, {
      description: `Seeds ${jobs.base}-${jobs.base + jobs.ids.length - 1}`,
    });
    jobs.done();
  } catch (err) {
    const failedAt = i;
    const again = () => void jobs.run((next) => postFrom(next, jobs, current, failedAt));
    toast.error(`Queued ${failedAt} of ${jobs.ids.length} jobs`, {
      description: err instanceof Error ? err.message : String(err),
      ...(retryable(err) ? { action: { label: RETRY, onClick: again } } : {}),
    });
  }
}

export function BatchDialog({ open, onOpenChange, build }: BatchDialogProps) {
  const [count, setCount] = useState(4);
  const [baseSeed, setBaseSeed] = useState(-1);
  const [autoSeed, setAutoSeed] = useState(true);
  // the Images view's action: the Generate button shows its uploads and its Stop cancels them
  const { run, busy } = useUploadAction(ACTIONS.images, {
    cancelled: UPLOAD_CANCELLED,
    failed: FAILED,
  });
  // one run at a time: a new one would stop the Generate upload under way
  const elsewhere = useActionProgress(ACTIONS.images, (e) => e !== undefined) && !busy;

  const handleSubmit = useCallback(async () => {
    const base = autoSeed ? Math.floor(Math.random() * 999999999) : baseSeed;
    const jobs: Jobs = {
      run,
      ids: Array.from({ length: count }, newSubmitId),
      base,
      done: () => onOpenChange(false),
    };
    try {
      // One build and one set of uploads: every job of the batch sends them with its own seed
      await run(async (ctx) => postFrom(ctx, jobs, await prepare(await build(ctx.batch)), 0));
    } catch (err) {
      toast.error(FAILED, { description: err instanceof Error ? err.message : String(err) });
    }
  }, [build, count, baseSeed, autoSeed, run, onOpenChange]);

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
          {elsewhere && (
            <p className="mr-auto self-center text-2xs text-muted-foreground">{WAIT_FOR_UPLOAD}</p>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void handleSubmit()} disabled={busy || elsewhere}>
            {busy && <Loader2 size={14} className="animate-spin mr-1" />}
            Submit {count} Jobs
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
