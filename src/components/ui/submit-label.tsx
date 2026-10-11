import { useEffect, useRef, useState, type ReactNode } from "react";
import { ProgressRing } from "@/components/ui/progress-ring";
import type { SubmitPhase, UploadView } from "@/lib/media/progress";
import { PREPARING, SENDING, STORING, uploadingText } from "@/lib/media/text";

const PHASE_WORD: Record<SubmitPhase, string> = {
  preparing: PREPARING,
  uploading: "Uploading",
  storing: STORING,
  sending: SENDING,
};

/** An upload's ring: spinning until its percentage shows, then filling. */
export function UploadRing({ percent }: { percent: number | null }) {
  return percent === null ? (
    <ProgressRing progress={0.25} size={14} strokeWidth={2} className="animate-spin" />
  ) : (
    <ProgressRing progress={percent / 100} size={14} strokeWidth={2} />
  );
}

export interface JobView {
  /** What the job is doing, as the server reports it ("Load model"). */
  task: string | null;
  progress: number;
  queued: number;
}

/** A submit button's icon and words: the upload while one runs, then the
 * running job's task and percentage, else the children. */
export function SubmitLabel({
  upload,
  job,
  running,
  children,
}: {
  upload: UploadView | null;
  job: JobView | null;
  /** The word for a job that reports no task. */
  running: string;
  children: ReactNode;
}) {
  if (upload) {
    return (
      <>
        <UploadRing percent={upload.percent} />
        {upload.percent !== null ? uploadingText(upload.percent) : PHASE_WORD[upload.phase]}
      </>
    );
  }
  if (job) {
    const percent = Math.round(job.progress * 100);
    return (
      <>
        <ProgressRing progress={job.progress} size={14} strokeWidth={2} />
        {`${job.task || running}${percent > 0 ? ` ${percent}%` : ""}${job.queued > 0 ? ` [+${job.queued}]` : ""}`}
      </>
    );
  }
  return <>{children}</>;
}

/** What a screen reader hears of a submit: each phase, the quarter marks of
 * an upload, then the job. */
export function announceText(upload: UploadView | null, active: boolean, running: string): string {
  if (upload) {
    if (upload.percent === null) return PHASE_WORD[upload.phase];
    return uploadingText(Math.floor(upload.percent / 25) * 25);
  }
  return active ? running : "";
}

const ANNOUNCE_MS = 1000;

/** Says `text` politely, at most once a second; the latest text wins. */
export function SubmitAnnouncer({ text }: { text: string }) {
  const [said, setSaid] = useState(text);
  const last = useRef(0);
  useEffect(() => {
    const wait = Math.max(0, last.current + ANNOUNCE_MS - Date.now());
    const timer = setTimeout(() => {
      last.current = Date.now();
      setSaid(text);
    }, wait);
    return () => clearTimeout(timer);
  }, [text]);
  return (
    <span className="sr-only" aria-live="polite">
      {said}
    </span>
  );
}
