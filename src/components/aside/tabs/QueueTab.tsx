import { useCallback, useMemo } from "react";
import { Trash2, ListOrdered, Ban } from "lucide-react";
import { toast } from "sonner";
import { useJobQueueStore } from "@/stores/jobStore";
import type { TrackedJob } from "@/stores/jobStore";
import { useUiStore } from "@/stores/uiStore";
import { ApiError } from "@/api/client";
import { useDeleteJob, useMoveJob, usePurgeJobs } from "@/api/hooks/useJobs";
import { viewOf } from "@/lib/jobs/cardActions";
import { MOVE_STARTED } from "@/lib/jobs/text";
import { QueueJobCard } from "./QueueJobCard";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ProgressRing } from "@/components/ui/progress-ring";

export function QueueTab() {
  const jobsMap = useJobQueueStore((s) => s.jobs);
  const clearTerminal = useJobQueueStore((s) => s.clearTerminal);
  const removeJob = useJobQueueStore((s) => s.removeJob);
  const pendingJobsSorted = useMemo(
    () =>
      Array.from(jobsMap.values())
        .filter((j) => j.status === "pending")
        .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt),
    [jobsMap],
  );
  const deleteJob = useDeleteJob();
  const purgeJobs = usePurgeJobs();
  const moveJob = useMoveJob();

  const { runningJobs, terminalJobs, totalCount, avgProgress } = useMemo(() => {
    const all = Array.from(jobsMap.values()).sort((a, b) => b.createdAt - a.createdAt);
    const running = all.filter((j) => j.status === "running");
    const avg =
      running.length > 0 ? running.reduce((sum, j) => sum + j.progress, 0) / running.length : 0;
    return {
      runningJobs: running,
      terminalJobs: all.filter(
        (j) => j.status === "completed" || j.status === "failed" || j.status === "cancelled",
      ),
      totalCount: all.length,
      avgProgress: avg,
    };
  }, [jobsMap]);

  const handleView = useCallback((job: TrackedJob) => {
    const view = viewOf(job.domain);
    if (view) useUiStore.getState().setNavView(view);
  }, []);

  /** Give a queued job a priority past every other queued job's: first or last. */
  const move = useCallback(
    (job: TrackedJob, to: "first" | "last") => {
      const others = pendingJobsSorted.filter((j) => j.id !== job.id).map((j) => j.priority);
      const priority =
        to === "first"
          ? Math.max(job.priority, ...others) + 1
          : Math.min(job.priority, ...others) - 1;
      moveJob.mutate(
        { id: job.id, priority },
        {
          onError: (err) => {
            if (err instanceof ApiError && err.status === 409) toast.info(MOVE_STARTED);
            else {
              toast.error("Could not move the job", {
                description: err instanceof Error ? err.message : String(err),
              });
            }
          },
        },
      );
    },
    [moveJob, pendingJobsSorted],
  );

  const handleRemove = useCallback(
    (job: TrackedJob) => {
      deleteJob.mutate(job.id, {
        onSettled: () => removeJob(job.id),
      });
    },
    [deleteJob, removeJob],
  );

  const handleClearHistory = useCallback(() => {
    purgeJobs.mutate(undefined, {
      onSuccess: (data) => {
        clearTerminal();
        if (data.deleted > 0) toast.success(`Purged ${data.deleted} jobs`);
      },
      onError: () => clearTerminal(),
    });
  }, [purgeJobs, clearTerminal]);

  const handleCancelAll = useCallback(() => {
    for (const job of pendingJobsSorted) {
      deleteJob.mutate(job.id);
    }
    toast.success(`Cancelling ${pendingJobsSorted.length} pending jobs`);
  }, [deleteJob, pendingJobsSorted]);

  if (totalCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
        <ListOrdered className="h-8 w-8" strokeWidth={1} />
        <p className="text-xs">No jobs in queue</p>
        <p className="text-2xs">Submit a generation to get started</p>
      </div>
    );
  }

  return (
    <div className="py-1">
      {/* Running */}
      {runningJobs.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 px-3 py-1">
            <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider flex-1">
              Running
            </p>
            {runningJobs.length > 1 && (
              <ProgressRing
                progress={avgProgress}
                size={14}
                strokeWidth={2}
                className="text-primary"
              />
            )}
          </div>
          {runningJobs.map((job) => (
            <QueueJobCard
              key={job.id}
              job={job}
              onView={handleView}
              onRemove={handleRemove}
              onMoveUp={(j) => move(j, "first")}
              onMoveDown={(j) => move(j, "last")}
            />
          ))}
        </div>
      )}

      {/* Pending */}
      {pendingJobsSorted.length > 0 && (
        <div>
          {runningJobs.length > 0 && <Separator className="my-1" />}
          <div className="flex items-center justify-between px-3 py-1">
            <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">
              Queued ({pendingJobsSorted.length})
            </p>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              onClick={handleCancelAll}
              title="Cancel all pending"
            >
              <Ban className="h-3 w-3" />
            </Button>
          </div>
          {pendingJobsSorted.map((job, i) => (
            <QueueJobCard
              key={job.id}
              job={job}
              place={{ first: i === 0, last: i === pendingJobsSorted.length - 1 }}
              moving={moveJob.isPending && moveJob.variables.id === job.id}
              onView={handleView}
              onRemove={handleRemove}
              onMoveUp={(j) => move(j, "first")}
              onMoveDown={(j) => move(j, "last")}
            />
          ))}
        </div>
      )}

      {/* Completed / Failed */}
      {terminalJobs.length > 0 && (
        <div>
          {(runningJobs.length > 0 || pendingJobsSorted.length > 0) && (
            <Separator className="my-1" />
          )}
          <div className="flex items-center justify-between px-3 py-1">
            <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">
              History ({terminalJobs.length})
            </p>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              onClick={handleClearHistory}
              title="Clear history"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          {terminalJobs.map((job) => (
            <QueueJobCard
              key={job.id}
              job={job}
              onView={handleView}
              onRemove={handleRemove}
              onMoveUp={(j) => move(j, "first")}
              onMoveDown={(j) => move(j, "last")}
            />
          ))}
        </div>
      )}
    </div>
  );
}
