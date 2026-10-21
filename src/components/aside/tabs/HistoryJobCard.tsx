import { useState } from "react";
import {
  ArchiveRestore,
  History,
  Repeat2,
  ScrollText,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { Job } from "@/api/types/v2";
import { useDeleteJob } from "@/api/hooks/useJobs";
import { useRunAgain } from "@/hooks/useRunAgain";
import { saveRecipe } from "@/inputs/recipes";
import { SAVE_RECIPE } from "@/lib/recipes/text";
import { useJobFact } from "@/hooks/useJobFact";
import { historySlots, type HistoryAction } from "@/lib/jobs/cardActions";
import { jobKind } from "@/lib/jobs/domains";
import { loadsModel } from "@/lib/jobs/requests";
import { RESTORE_BOTH, RESTORE_SETTINGS, RUN_AGAIN, slotWords } from "@/lib/jobs/text";
import { DELETE_JOB, DELETE_JOB_NOTE } from "@/lib/gallery/text";
import { ageText } from "@/lib/media/text";
import { jobTarget, restoreFrom } from "@/lib/request/restore";
import { MediaImg } from "@/components/ui/media";
import { Badge } from "@/components/ui/badge";
import { JobWarnings } from "@/components/generation/JobWarnings";
import { JOB_ICONS } from "./jobIcons";
import { ActionSlot } from "@/components/ui/action-slot";

const SLOTS: Record<HistoryAction, { label: string; icon: LucideIcon; note?: string }> = {
  restoreSettings: { label: RESTORE_SETTINGS, icon: History },
  restoreBoth: { label: RESTORE_BOTH, icon: ArchiveRestore },
  runAgain: { label: RUN_AGAIN, icon: Repeat2 },
  saveRecipe: { label: SAVE_RECIPE, icon: ScrollText },
  delete: { label: DELETE_JOB, icon: Trash2, note: DELETE_JOB_NOTE },
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

function agoText(iso: string): string {
  return ageText(Date.now() - new Date(iso).getTime());
}

interface HistoryJobCardProps {
  job: Job;
}

export function HistoryJobCard({ job }: HistoryJobCardProps) {
  const deleteJob = useDeleteJob();
  const { runAgain, isRunning } = useRunAgain();
  const facts = useJobFact(job.id);
  const [restoring, setRestoring] = useState(false);
  const kind = jobKind(job.type);
  const TypeIcon = JOB_ICONS[kind.icon];
  // Video jobs leave `images` empty and carry their poster on the video ref.
  const thumbUrl = job.result?.images[0]?.url ?? job.result?.videos?.[0]?.thumbnail_url ?? null;
  const timestamp = job.completed_at ?? job.created_at;

  const restore = (both: boolean) => {
    setRestoring(true);
    void restoreFrom(jobTarget(job), both ? "both" : "settings").finally(() => setRestoring(false));
  };
  const act: Record<HistoryAction, () => void> = {
    restoreSettings: () => restore(false),
    restoreBoth: () => restore(true),
    runAgain: () => void runAgain(job.id),
    saveRecipe: () => void saveRecipe({ kind: "job", job }),
    delete: () => deleteJob.mutate(job.id),
  };
  const slots = historySlots(
    {
      type: job.type,
      status: job.status,
      hasParams: job.result !== null,
      loads: loadsModel(job.type, job.result?.params),
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
        <MediaImg
          image={thumbUrl}
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
          {agoText(timestamp)}
        </p>
      </div>

      {/* Slots fixed by the job's type, shown on hover or keyboard focus */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity shrink-0">
        {slots.map((slot) => {
          const words = slotWords(slot);
          return (
            <ActionSlot
              key={slot.action}
              label={SLOTS[slot.action].label}
              icon={SLOTS[slot.action].icon}
              {...words}
              note={words.note ?? SLOTS[slot.action].note ?? null}
              busy={busy && slot.action !== "delete"}
              onAct={act[slot.action]}
            />
          );
        })}
      </div>
    </div>
  );
}
