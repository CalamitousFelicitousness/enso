import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Eye, Repeat2, Trash2, X, type LucideIcon } from "lucide-react";
import type { TrackedJob } from "@/stores/jobStore";
import { useCancelJob } from "@/api/hooks/useJobs";
import { markJobCancelled } from "@/hooks/useJobTracker";
import { useRunAgain } from "@/hooks/useRunAgain";
import { useJobFact } from "@/inputs/jobs";
import { queueSlots, type QueueAction } from "@/lib/jobs/cardActions";
import { jobKind } from "@/lib/jobs/domains";
import { FAILED_WHILE_CLOSED, MOVE_DOWN, MOVE_UP, reasonText, RUN_AGAIN } from "@/lib/jobs/text";
import { Badge } from "@/components/ui/badge";
import { JobWarnings } from "@/components/generation/JobWarnings";
import { JOB_ICONS } from "./jobIcons";
import { ActionSlot } from "@/components/ui/action-slot";

const SLOTS: Record<QueueAction, { label: string; icon: LucideIcon }> = {
  moveUp: { label: MOVE_UP, icon: ChevronUp },
  moveDown: { label: MOVE_DOWN, icon: ChevronDown },
  cancel: { label: "Cancel", icon: X },
  view: { label: "View result", icon: Eye },
  runAgain: { label: RUN_AGAIN, icon: Repeat2 },
  remove: { label: "Remove", icon: Trash2 },
};

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "running":
      return "default";
    case "completed":
      return "secondary";
    case "failed":
    case "cancelled":
      return "destructive";
    default:
      return "outline";
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function useElapsed(startTime: number, active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const update = () =>
      setElapsed(
        Math.floor(
          performance.now() / 1000 - startTime / 1000 + (Date.now() - performance.now()) / 1000,
        ),
      );
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startTime, active]);
  return elapsed;
}

interface QueueJobCardProps {
  job: TrackedJob;
  /** Its place among the queued jobs. */
  place?: { first: boolean; last: boolean };
  /** A move of this job is on its way to the server. */
  moving?: boolean;
  onView: (job: TrackedJob) => void;
  onRemove: (job: TrackedJob) => void;
  onMoveUp: (job: TrackedJob) => void;
  onMoveDown: (job: TrackedJob) => void;
}

export function QueueJobCard({
  job,
  place = { first: false, last: false },
  moving = false,
  onView,
  onRemove,
  onMoveUp,
  onMoveDown,
}: QueueJobCardProps) {
  const cancelJob = useCancelJob();
  const { runAgain, isRunning } = useRunAgain();
  const facts = useJobFact(job.id);
  const kind = jobKind(job.request?.type ?? job.domain);
  const DomainIcon = JOB_ICONS[kind.icon];
  const isRunningJob = job.status === "running";
  const isTerminal =
    job.status === "completed" || job.status === "failed" || job.status === "cancelled";
  const elapsed = useElapsed(job.createdAt, isRunningJob);
  const busy = moving || isRunning(job.id);

  const handleCancel = useCallback(() => {
    // A queued job is cancelled once the server says so; a running one ends
    // through its own socket
    const queued = job.status === "pending";
    cancelJob.mutate(job.id, {
      onSuccess: () => {
        if (queued) markJobCancelled(job.id);
      },
    });
  }, [cancelJob, job.id, job.status]);

  const act: Record<QueueAction, () => void> = {
    moveUp: () => onMoveUp(job),
    moveDown: () => onMoveDown(job),
    cancel: handleCancel,
    view: () => onView(job),
    runAgain: () => void runAgain(job.id),
    remove: () => onRemove(job),
  };
  const slots = queueSlots(
    { status: job.status, domain: job.domain, hasResult: job.result !== null },
    facts,
    place,
  );

  return (
    <div className="space-y-1 px-3 py-1.5" aria-busy={busy || undefined}>
      <div className="flex items-center gap-1.5 text-2xs min-w-0">
        <DomainIcon className="h-3 w-3 shrink-0 text-muted-foreground" />

        <span className="truncate flex-1 min-w-0">
          {kind.label}
          {job.task ? ` - ${job.task}` : ""}
        </span>
        <Badge variant={statusBadgeVariant(job.status)} className="text-4xs px-1 py-0 shrink-0">
          {job.status}
        </Badge>
        <JobWarnings warnings={job.result?.warnings} />
        {/* Three slots in every state, so the row keeps its width */}
        {slots.map((slot) => (
          <ActionSlot
            key={slot.action}
            label={SLOTS[slot.action].label}
            icon={SLOTS[slot.action].icon}
            reason={slot.reason && reasonText(slot.reason)}
            busy={busy && slot.action !== "cancel"}
            onAct={act[slot.action]}
          />
        ))}
      </div>

      {/* Progress bar for running jobs */}
      {isRunningJob && (
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 rounded bg-primary/20 overflow-hidden flex-1">
            {job.step > 0 || job.progress > 0 ? (
              <div
                className="h-full bg-primary rounded transition-all"
                style={{ width: `${(job.progress * 100).toFixed(1)}%` }}
              />
            ) : (
              <div className="h-full bg-primary rounded animate-[indeterminate_1.5s_ease-in-out_infinite] origin-left" />
            )}
          </div>
          <span className="text-4xs text-muted-foreground font-mono tabular-nums w-8 text-right">
            {job.step > 0
              ? `${job.step}/${job.steps}`
              : job.progress > 0
                ? `${Math.round(job.progress * 100)}%`
                : "···"}
          </span>
        </div>
      )}

      {/* Stage name + optional counter + phase hint */}
      {isRunningJob && (job.stageName || (job.phase && !(job.step > 0))) && (
        <div className="flex items-center gap-1.5 text-4xs text-muted-foreground">
          {job.stageName && (
            <span className="font-medium">
              Stage {job.stage + 1}/{job.stageCount} · {job.stageName}
            </span>
          )}
          {job.phase && !(job.step > 0) && (
            <span className="text-muted-foreground/50 truncate">{job.phase}</span>
          )}
        </div>
      )}

      {/* ETA and elapsed for running */}
      {isRunningJob && (
        <div className="flex items-center gap-2 text-4xs text-muted-foreground">
          <span>{formatDuration(elapsed)} elapsed</span>
          {job.eta > 0 && <span>ETA: ~{formatDuration(job.eta)}</span>}
        </div>
      )}

      {/* Preview thumbnail for running */}
      {isRunningJob && job.previewUrl && (
        <img
          src={job.previewUrl}
          alt="Preview"
          className="w-full rounded-sm max-h-24 object-cover"
        />
      )}

      {/* Error message */}
      {job.status === "failed" && job.error && (
        <p className="text-4xs text-destructive truncate" title={job.error}>
          {job.error}
        </p>
      )}
      {job.status === "failed" && job.endedWhileClosed && (
        <p className="text-4xs text-muted-foreground">{FAILED_WHILE_CLOSED}</p>
      )}

      {/* Timestamp for terminal */}
      {isTerminal && (
        <p className="text-4xs text-muted-foreground">
          {new Date(job.createdAt).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
