import { useState } from "react";
import { ArchiveRestore, Check, Copy, ImageDown, Repeat2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContextMenuLabel } from "@/components/ui/context-menu";
import { SlotButton, SlotMenuItem } from "@/components/ui/slot-row";
import { useGalleryJob } from "@/hooks/useGalleryJob";
import { useMinute } from "@/hooks/useMinute";
import { sharedReason, type GalleryAction } from "@/lib/jobs/cardActions";
import {
  COPY_JOB_ID,
  outputJobText,
  reasonText,
  RESTORE_BOTH,
  RESTORE_INPUTS,
  RUN_AGAIN,
  slotWords,
} from "@/lib/jobs/text";
import { cn } from "@/lib/utils";

const ROWS: Record<GalleryAction, { label: string; icon: LucideIcon }> = {
  restoreInputs: { label: RESTORE_INPUTS, icon: ImageDown },
  restoreBoth: { label: RESTORE_BOTH, icon: ArchiveRestore },
  runAgain: { label: RUN_AGAIN, icon: Repeat2 },
};

/** The job's line, and the reason its three slots share when they share one,
 * which the slots then leave to it. */
function useJobLine(path: string) {
  const job = useGalleryJob(path);
  const now = useMinute();
  const record = typeof job.facts === "string" ? null : job.facts;
  const shared = sharedReason(job.slots);
  return {
    job,
    line: outputJobText(job.lookup, record, now),
    // the line already says why while the job is looked up or missing
    detail: shared && job.lookup.state === "found" ? reasonText(shared) : null,
    silent: shared !== null,
  };
}

function CopyJobId({ id }: { id: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("h-5 w-5 shrink-0", !id && "invisible")}
      aria-label={COPY_JOB_ID}
      title={id ? `${COPY_JOB_ID} (${id})` : COPY_JOB_ID}
      onClick={() => {
        if (!id) return;
        void navigator.clipboard
          .writeText(id)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {});
      }}
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
    </Button>
  );
}

/** The job that made the selected file: a line naming it and its three
 * actions, always in place, so the column keeps its height for any file. */
export function GalleryJobRows({ path }: { path: string }) {
  const { job, line, detail, silent } = useJobLine(path);
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-2xs text-muted-foreground" title={line}>
            {line}
          </p>
          <p className="min-h-[1lh] truncate text-3xs text-muted-foreground/70">{detail}</p>
        </div>
        <CopyJobId id={job.lookup.state === "found" ? job.lookup.id : null} />
      </div>
      {job.slots.map((slot) => (
        <SlotButton
          key={slot.action}
          icon={ROWS[slot.action].icon}
          label={ROWS[slot.action].label}
          {...slotWords(slot)}
          busy={slot.action === "runAgain" && job.busy}
          silent={silent}
          onAct={job.act[slot.action]}
        />
      ))}
    </div>
  );
}

/** The same three actions in a file's menu, under the job's line. */
export function GalleryJobItems({ path }: { path: string }) {
  const { job, line, detail, silent } = useJobLine(path);
  return (
    <>
      <ContextMenuLabel className="text-3xs font-normal text-muted-foreground">
        <span className="block truncate">{line}</span>
        {detail && <span className="block truncate">{detail}</span>}
      </ContextMenuLabel>
      {job.slots.map((slot) => (
        <SlotMenuItem
          key={slot.action}
          icon={ROWS[slot.action].icon}
          label={ROWS[slot.action].label}
          {...slotWords(slot)}
          busy={slot.action === "runAgain" && job.busy}
          silent={silent}
          onAct={job.act[slot.action]}
        />
      ))}
    </>
  );
}
