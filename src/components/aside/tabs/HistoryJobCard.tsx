import { useState } from "react";
import { ArchiveRestore, History, Repeat2, Trash2, type LucideIcon } from "lucide-react";
import type { Job } from "@/api/types/v2";
import { useDeleteJob } from "@/api/hooks/useJobs";
import { useRunAgain } from "@/hooks/useRunAgain";
import { useJobFact } from "@/inputs/jobs";
import { historySlots, type HistoryAction } from "@/lib/jobs/cardActions";
import { jobKind } from "@/lib/jobs/domains";
import { reasonText, RESTORE_BOTH, RESTORE_SETTINGS, RUN_AGAIN } from "@/lib/jobs/text";
import { jobTarget, restoreSettings, restoreSettingsAndInputs } from "@/lib/request/restore";
import { resolveImageSrc } from "@/lib/utils";
import { useGenerationStore } from "@/stores/generationStore";
import { useJobQueueStore } from "@/stores/jobStore";
import { useVideoStore } from "@/stores/videoStore";
import { Badge } from "@/components/ui/badge";
import { JobWarnings } from "@/components/generation/JobWarnings";
import { JOB_ICONS } from "./jobIcons";
import { ActionSlot } from "@/components/ui/action-slot";

const SLOTS: Record<HistoryAction, { label: string; icon: LucideIcon }> = {
  restoreSettings: { label: RESTORE_SETTINGS, icon: History },
  restoreBoth: { label: RESTORE_BOTH, icon: ArchiveRestore },
  runAgain: { label: RUN_AGAIN, icon: Repeat2 },
  delete: { label: "Delete", icon: Trash2 },
};

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "secondary";
    case "failed":
    case "cancelled":
      return "destructive";
    default:
      return "outline";
  }
}

function formatRelativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface HistoryJobCardProps {
  job: Job;
}

export function HistoryJobCard({ job }: HistoryJobCardProps) {
  const deleteJob = useDeleteJob();
  const { runAgain, isRunning } = useRunAgain();
  const facts = useJobFact(job.id);
  const onStrip = useGenerationStore((s) => s.results.some((r) => r.id === job.id));
  const onVideoStrip = useVideoStore((s) => s.results.some((r) => r.id === job.id));
  const tracked = useJobQueueStore((s) => s.jobs.has(job.id));
  const [restoring, setRestoring] = useState(false);
  const kind = jobKind(job.type);
  const TypeIcon = JOB_ICONS[kind.icon];
  // Video jobs leave `images` empty and carry their poster on the video ref.
  const thumbUrl = job.result?.images[0]?.url ?? job.result?.videos?.[0]?.thumbnail_url ?? null;
  const timestamp = job.completed_at ?? job.created_at;

  const restore = (both: boolean) => {
    setRestoring(true);
    void jobTarget(job)
      .then((target) => (both ? restoreSettingsAndInputs(target) : restoreSettings(target)))
      .finally(() => setRestoring(false));
  };
  const act: Record<HistoryAction, () => void> = {
    restoreSettings: () => restore(false),
    restoreBoth: () => restore(true),
    runAgain: () => void runAgain(job.id),
    delete: () => deleteJob.mutate(job.id),
  };
  const slots = historySlots(
    {
      type: job.type,
      status: job.status,
      hasParams: job.result !== null,
      sentHere: onStrip || onVideoStrip || tracked,
    },
    facts,
  );
  const busy = restoring || isRunning(job.id);

  return (
    <div
      className="group flex items-start gap-2 px-3 py-1.5 hover:bg-muted/50 rounded"
      aria-busy={busy || undefined}
    >
      {/* Thumbnail or type icon */}
      {thumbUrl ? (
        <img
          src={resolveImageSrc(thumbUrl)}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-8 w-8 rounded-sm object-cover shrink-0"
        />
      ) : (
        <div className="h-8 w-8 rounded-sm bg-muted flex items-center justify-center shrink-0">
          <TypeIcon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-1.5 text-2xs">
          <TypeIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{kind.label}</span>
          <Badge variant={statusBadgeVariant(job.status)} className="text-4xs px-1 py-0 shrink-0">
            {job.status}
          </Badge>
          <JobWarnings warnings={job.result?.warnings} />
        </div>

        {job.status === "failed" && job.error && (
          <p className="text-4xs text-destructive truncate" title={job.error}>
            {job.error}
          </p>
        )}

        <p className="text-4xs text-muted-foreground font-mono tabular-nums">
          {formatRelativeTime(timestamp)}
        </p>
      </div>

      {/* Slots fixed by the job's type, shown on hover or keyboard focus */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity shrink-0">
        {slots.map((slot) => (
          <ActionSlot
            key={slot.action}
            label={SLOTS[slot.action].label}
            icon={SLOTS[slot.action].icon}
            reason={slot.reason && reasonText(slot.reason)}
            busy={busy && slot.action !== "delete"}
            onAct={act[slot.action]}
          />
        ))}
      </div>
    </div>
  );
}
