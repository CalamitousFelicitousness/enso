// One action's submit: the job is built onto a fresh upload batch, prepared
// once and posted under an id a Retry sends again, so a Retry never queues a
// second job. Stop cancels the uploads; the post itself cannot be taken back.

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { UploadRefused } from "@/api/blobs";
import { ApiError } from "@/api/client";
import { clearSubmitProgress, setBatchProgress, setSubmitPhase } from "@/inputs/progress";
import {
  newSubmitId,
  post,
  prepare,
  SubmitRefused,
  type Prepared,
  type Submission,
} from "@/inputs/submit";
import { UploadBatch } from "@/inputs/uploads";
import { UserAbortError } from "@/lib/abort";
import { ReplayError } from "@/lib/jobs/replay";
import { RETRY, SUBMIT_FAILED, UPLOAD_CANCELLED } from "@/lib/media/text";

interface SubmitOptions {
  build: (batch: UploadBatch) => Promise<Submission>;
  /** Names the action's progress, which its button shows. */
  action: string;
}

/** A failure a Retry can get past: the server busy or full, the network. */
export function retryable(err: unknown): boolean {
  if (err instanceof UploadRefused) {
    return err.failure.kind !== "unreadable" && err.failure.kind !== "storeOff";
  }
  if (err instanceof SubmitRefused)
    return err.failure.kind === "full" || err.failure.kind === "busy";
  if (err instanceof ReplayError) return false;
  return !(err instanceof ApiError && err.status >= 400 && err.status < 500);
}

interface Runner extends SubmitOptions {
  /** Aborts the uploads of the submit in progress; null once its post has begun. */
  uploads: { current: AbortController | null };
  setSubmitting: (on: boolean) => void;
}

/** Where a submit got to, for its Retry. */
interface Reached {
  submission?: Submission;
  prepared?: Prepared;
}

/** Run a submit's steps from where it got to: building, preparing or posting. */
async function runSubmit(runner: Runner, from: Reached, submitId: string): Promise<void> {
  const { action, build, uploads, setSubmitting } = runner;
  const abort = new AbortController();
  uploads.current = abort;
  setSubmitting(true);
  setSubmitPhase(action, "preparing");
  let submission = from.submission ?? null;
  let prepared = from.prepared ?? null;
  try {
    if (!prepared) {
      submission = submission
        ? { ...submission, batch: submission.batch.again({ signal: abort.signal }) }
        : await build(
            new UploadBatch(action, {
              signal: abort.signal,
              onProgress: (p) => setBatchProgress(action, p),
            }),
          );
      prepared = await prepare(submission);
    }
    if (abort.signal.aborted) throw new UserAbortError("Upload cancelled");
    uploads.current = null;
    setSubmitPhase(action, "sending");
    await post(prepared, submitId);
  } catch (err) {
    if (err instanceof UserAbortError) {
      if (abort.signal.aborted) toast.info(UPLOAD_CANCELLED);
      return;
    }
    console.error(`[submit] ${action}`, err);
    const reached: Reached = {
      ...(submission ? { submission } : {}),
      ...(prepared ? { prepared } : {}),
    };
    const canRetry = (submission !== null || prepared !== null) && retryable(err);
    toast.error(SUBMIT_FAILED, {
      description: err instanceof Error ? err.message : String(err),
      ...(canRetry
        ? { action: { label: RETRY, onClick: () => void runSubmit(runner, reached, submitId) } }
        : {}),
    });
  } finally {
    if (uploads.current === abort) uploads.current = null;
    clearSubmitProgress(action);
    setSubmitting(false);
  }
}

export function useSubmitToQueue({ build, action }: SubmitOptions) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const uploads = useRef<AbortController | null>(null);

  const submit = useCallback(
    () => runSubmit({ build, action, uploads, setSubmitting: setIsSubmitting }, {}, newSubmitId()),
    [build, action],
  );

  /** Stop the uploads of the submit in progress; false once its post has begun. */
  const cancel = useCallback((): boolean => {
    const current = uploads.current;
    if (!current) return false;
    current.abort();
    return true;
  }, []);

  return { submit, isSubmitting, cancel };
}
