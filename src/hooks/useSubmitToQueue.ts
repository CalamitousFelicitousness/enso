// One action's submit: the job is built onto the run's upload batch, prepared
// once and posted under an id a Retry sends again, so a Retry never queues a
// second job. Stop cancels the uploads; the post itself cannot be taken back.

import { useCallback } from "react";
import { toast } from "sonner";
import { ApiError } from "@/api/client";
import type { RetryOffer, RunContext, RunOptions } from "@/inputs/action";
import {
  newSubmitId,
  post,
  prepare,
  SubmitRefused,
  type Prepared,
  type Submission,
} from "@/inputs/submit";
import type { UploadBatch } from "@/inputs/uploads";
import { ReplayError } from "@/lib/jobs/replay";
import { UploadRefused } from "@/lib/media/refused";
import { RETRY, SUBMIT_FAILED, UPLOAD_CANCELLED } from "@/lib/media/text";
import { useUploadAction } from "./useUploadAction";

interface SubmitOptions {
  build: (batch: UploadBatch) => Submission | Promise<Submission>;
  /** Names the action's run, whose progress its slot shows and whose Stop cancels it. */
  action: string;
  /** What the caller offers for a refused upload, before a plain Retry. */
  refused?: (err: UploadRefused) => RetryOffer | null;
  /** Called once the server has taken the job. */
  onPosted?: () => void;
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

/** Where a submit got to, for its Retry. */
interface Reached {
  submission?: Submission;
  prepared?: Prepared;
}

type Run = <T>(work: (ctx: RunContext) => Promise<T>, options?: RunOptions) => Promise<T | null>;

interface Runner {
  action: string;
  build: SubmitOptions["build"];
  refused: SubmitOptions["refused"];
  onPosted: SubmitOptions["onPosted"];
  run: Run;
}

/** Run a submit's steps from where it got to: building, preparing or posting. */
async function runSubmit(runner: Runner, from: Reached, submitId: string): Promise<void> {
  const reached: Reached = { ...from };
  const offer = (err: unknown): RetryOffer | null =>
    (reached.submission || reached.prepared) && retryable(err)
      ? { label: RETRY, run: () => void runSubmit(runner, reached, submitId) }
      : null;
  try {
    await runner.run(
      async (ctx) => {
        if (!reached.prepared) {
          reached.submission = reached.submission
            ? { ...reached.submission, batch: ctx.again(reached.submission.batch) }
            : await runner.build(ctx.batch);
          reached.prepared = await prepare(reached.submission);
        }
        ctx.commit();
        ctx.phase("sending");
        await post(reached.prepared, submitId);
        runner.onPosted?.();
      },
      { retry: (err) => runner.refused?.(err) ?? offer(err) },
    );
  } catch (err) {
    console.error(`[submit] ${runner.action}`, err);
    const retry = offer(err);
    toast.error(SUBMIT_FAILED, {
      description: err instanceof Error ? err.message : String(err),
      ...(retry ? { action: { label: retry.label, onClick: retry.run } } : {}),
    });
  }
}

export function useSubmitToQueue({ build, action, refused, onPosted }: SubmitOptions) {
  const { run, busy, cancel } = useUploadAction(action, {
    cancelled: UPLOAD_CANCELLED,
    failed: SUBMIT_FAILED,
  });

  const submit = useCallback(
    () => runSubmit({ action, build, refused, onPosted, run }, {}, newSubmitId()),
    [action, build, refused, onPosted, run],
  );

  return { submit, isSubmitting: busy, cancel };
}
