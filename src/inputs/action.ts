// One action a view starts that sends bytes: a run under the action's key
// with its own controller and batch, the slot's progress, Stop, the words for
// a cancel and a refused upload, and the Retry a refusal offers. The submit
// hook is this plus the POST; the read-once flows are this plus their call.

import { toast } from "sonner";
import { UserAbortError } from "@/lib/abort";
import { LutRefused } from "@/lib/lut";
import type { BatchProgress } from "@/lib/media/batch";
import type { SubmitPhase } from "@/lib/media/progress";
import { UploadRefused } from "@/lib/media/refused";
import { CANCEL } from "@/lib/media/text";
import { sayLutRefused } from "./lutRefused";
import { beginRun, commitRun, endRun, isCurrentRun, setRunPhase, setRunProgress } from "./progress";
import { UploadBatch } from "./uploads";

export interface RunContext {
  batch: UploadBatch;
  signal: AbortSignal;
  /** An earlier batch's items again, on this run's signal and progress. */
  again: (batch: UploadBatch) => UploadBatch;
  /** The slot in a phase the batch does not report: sending. */
  phase: (phase: SubmitPhase) => void;
  /** From here Stop no longer cancels the run: its job is on its way. Throws
   * when Stop came first, though nothing was left to upload. */
  commit: () => void;
}

/** What a refused upload's toast offers. */
export interface RetryOffer {
  label: string;
  run: () => void;
  /** Offer Cancel beside it. */
  cancel?: boolean;
}

export interface RunOptions {
  /** The offer for a refused upload; null for none. */
  retry?: (err: UploadRefused) => RetryOffer | null;
  /** Say nothing when Stop cancels the run. */
  quiet?: boolean;
}

export interface ActionSettings {
  /** The action's uploads are read once. */
  transient: boolean;
  /** Said when Stop cancels a run. */
  cancelled: string;
  /** The title of a refused upload's toast. */
  failed: string;
}

/** What a run says. */
export interface Notices {
  cancelled(text: string): void;
  refused(title: string, err: UploadRefused, offer: RetryOffer | null): void;
  lut(err: LutRefused): void;
}

const TOASTS: Notices = {
  cancelled: (text) => toast.info(text),
  refused: (title, err, offer) =>
    toast.error(title, {
      description: err.message,
      ...(offer ? { action: { label: offer.label, onClick: offer.run } } : {}),
      ...(offer?.cancel ? { cancel: { label: CANCEL, onClick: () => {} } } : {}),
    }),
  lut: sayLutRefused,
};

/** Run `work` under `action`. Answers its result, or null when Stop cancelled
 * it or an upload or a LUT was refused, each said once; any other error is
 * the caller's. A run superseded by a newer one under the same key clears
 * nothing of the newer one's and says nothing of its own cancel. */
export async function runAction<T>(
  action: string,
  work: (ctx: RunContext) => Promise<T>,
  settings: ActionSettings,
  options: RunOptions = {},
  notices: Notices = TOASTS,
): Promise<T | null> {
  const { token, signal } = beginRun(action);
  const onProgress = (report: BatchProgress) => setRunProgress(action, token, report);
  const ctx: RunContext = {
    batch: new UploadBatch(action, { signal, onProgress, transient: settings.transient }),
    signal,
    again: (batch) => batch.again({ signal, onProgress }),
    phase: (phase) => setRunPhase(action, token, phase),
    commit: () => {
      if (signal.aborted) throw new UserAbortError("Upload cancelled");
      commitRun(action, token);
    },
  };
  try {
    return await work(ctx);
  } catch (err) {
    if (err instanceof UserAbortError) {
      // a builder that already said why throws one too; only Stop's is a cancel
      if (signal.aborted && !options.quiet && isCurrentRun(action, token)) {
        notices.cancelled(settings.cancelled);
      }
      return null;
    }
    if (err instanceof UploadRefused) {
      notices.refused(settings.failed, err, options.retry?.(err) ?? null);
      return null;
    }
    if (err instanceof LutRefused) {
      notices.lut(err);
      return null;
    }
    throw err;
  } finally {
    endRun(action, token);
  }
}
