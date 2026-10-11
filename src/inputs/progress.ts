// How far an action's submit has got, kept outside the components that start
// it, so an upload's events re-render the label that shows them and nothing
// else. Updated only when the phase or the whole percentage changes.

import { create } from "zustand";
import type { BatchProgress } from "@/lib/media/batch";

export type SubmitPhase = "preparing" | "uploading" | "storing" | "sending";

export interface SubmitProgress {
  phase: SubmitPhase;
  /** Of the bytes to upload, 0 to 100. */
  percent: number;
}

interface State {
  byAction: Readonly<Record<string, SubmitProgress>>;
}

export const useSubmitProgress = create<State>()(() => ({ byAction: {} }));

function set(action: string, next: SubmitProgress | null): void {
  const current = useSubmitProgress.getState().byAction[action];
  if (next && current?.phase === next.phase && current.percent === next.percent) return;
  if (!next && !current) return;
  useSubmitProgress.setState((s) => {
    const byAction = { ...s.byAction };
    if (next) byAction[action] = next;
    else delete byAction[action];
    return { byAction };
  });
}

export function setSubmitPhase(action: string, phase: SubmitPhase): void {
  set(action, { phase, percent: phase === "sending" ? 100 : 0 });
}

/** A batch's progress, as the action's label shows it. */
export function setBatchProgress(action: string, progress: BatchProgress): void {
  if (progress.phase === "claiming") {
    set(action, { phase: "preparing", percent: 0 });
    return;
  }
  const percent = progress.total > 0 ? Math.floor((progress.sent / progress.total) * 100) : 0;
  set(action, { phase: progress.phase, percent });
}

export function clearSubmitProgress(action: string): void {
  set(action, null);
}
