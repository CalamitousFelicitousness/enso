import { useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { submitJob, type Submission } from "@/inputs/jobs";
import { UserAbortError } from "@/hooks/useSubmitToQueue";
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
  build: () => Promise<Submission>;
}

export function BatchDialog({ open, onOpenChange, build }: BatchDialogProps) {
  const [count, setCount] = useState(4);
  const [baseSeed, setBaseSeed] = useState(-1);
  const [autoSeed, setAutoSeed] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    try {
      // One build: every job of the batch sends the same uploads with its own seed
      const submission = await build();
      const resolvedBase = autoSeed ? Math.floor(Math.random() * 999999999) : baseSeed;
      for (let i = 0; i < count; i++) {
        const request = { ...submission.request, seed: resolvedBase + i } as JobRequest;
        await submitJob({ ...submission, request });
      }
      toast.success(`Queued ${count} jobs`, {
        description: `Seeds ${resolvedBase}-${resolvedBase + count - 1}`,
      });
      onOpenChange(false);
    } catch (err) {
      if (err instanceof UserAbortError) return;
      toast.error("Failed to submit batch", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [build, count, baseSeed, autoSeed, onOpenChange]);

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
