// How far an action's run has got, as its slot shows it: the phase, the
// percentage of the bytes sent and the files done. A batch reports on every
// progress event; a slot needs to change only when what it shows does.

import type { BatchProgress } from "./batch";

export type SubmitPhase = "preparing" | "uploading" | "storing" | "sending";

/** The keys actions run under: a slot and a Stop name their action by one. */
export const ACTIONS = {
  images: "images",
  video: "video",
  process: "process",
  caption: "caption",
  interrogate: "interrogate",
  pngInfo: "png-info",
  recipe: "recipe",
} as const;

/** The Enhance of one prompt surface. */
export function enhanceAction(surface: string): string {
  return `enhance:${surface}`;
}

export interface SubmitProgress {
  phase: SubmitPhase;
  /** Of the bytes to upload, 0 to 100. */
  percent: number;
  done: number;
  files: number;
  sent: number;
  total: number;
  /** When the uploads began; null before. */
  startedAt: number | null;
  /** The uploads have run long enough for their percentage to show. */
  shown: boolean;
}

/** An upload shows its percentage once it has run this long. */
export const PERCENT_AFTER_MS = 1000;

const AT_REST = {
  percent: 0,
  done: 0,
  files: 0,
  sent: 0,
  total: 0,
  startedAt: null,
  shown: false,
} as const;

/** A run in a phase of its own, the counts it had kept. */
export function inPhase(current: SubmitProgress | undefined, phase: SubmitPhase): SubmitProgress {
  return {
    ...(current ?? AT_REST),
    phase,
    percent: phase === "sending" ? 100 : (current?.percent ?? 0),
  };
}

/** The progress after a batch's report; `current` itself when nothing a
 * slot shows changed: the phase, the whole percentage, the files done, or
 * whether the percentage shows. It shows once the uploads have run a second,
 * so a small one never flashes a number. */
export function advance(
  current: SubmitProgress | undefined,
  report: BatchProgress,
  now: number,
): SubmitProgress {
  if (report.phase === "claiming") {
    return current?.phase === "preparing" ? current : inPhase(current, "preparing");
  }
  const percent = report.total > 0 ? Math.floor((report.sent / report.total) * 100) : 0;
  const startedAt = current?.startedAt ?? now;
  const shown = (current?.shown ?? false) || now - startedAt >= PERCENT_AFTER_MS;
  if (
    current &&
    current.phase === report.phase &&
    current.percent === percent &&
    current.done === report.done &&
    current.files === report.files &&
    current.shown === shown
  ) {
    return current;
  }
  return {
    phase: report.phase,
    percent,
    done: report.done,
    files: report.files,
    sent: report.sent,
    total: report.total,
    startedAt,
    shown,
  };
}

/** The percentage a slot shows while the uploads run, once it shows. */
export function visiblePercent(entry: SubmitProgress | undefined): number | null {
  return entry?.phase === "uploading" && entry.shown ? entry.percent : null;
}

/** A run's upload as a slot shows it. */
export interface UploadView {
  phase: SubmitPhase;
  /** The percentage to show; null until the uploads have run a second. */
  percent: number | null;
}

/** What a slot shows of a run's upload; null while none runs. */
export function uploadView(entry: SubmitProgress | undefined): UploadView | null {
  return entry ? { phase: entry.phase, percent: visiblePercent(entry) } : null;
}
