// How far each action's run has got, kept outside the components that start
// it so an upload's events re-render the slots that show them and nothing
// else, and each action's controller, so a Stop rendered by another component
// reaches the run. A newer run under a key supersedes the older one: only the
// newer writes the slot, ends it and answers to Stop.

import { create } from "zustand";
import type { BatchProgress } from "@/lib/media/batch";
import { advance, inPhase, type SubmitPhase, type SubmitProgress } from "@/lib/media/progress";

interface State {
  byAction: Readonly<Record<string, SubmitProgress>>;
}

export const useSubmitProgress = create<State>()(() => ({ byAction: {} }));

interface Run {
  token: number;
  abort: AbortController;
  /** Its job is on its way: Stop no longer cancels it. */
  committed: boolean;
}

const runs = new Map<string, Run>();
let lastToken = 0;

function write(action: string, next: SubmitProgress | null): void {
  useSubmitProgress.setState((s) => {
    const byAction = { ...s.byAction };
    if (next) byAction[action] = next;
    else delete byAction[action];
    return { byAction };
  });
}

/** Start a run under an action key, preparing. A run it replaces that has not
 * sent its job stops, and ends without a word, being no longer current. */
export function beginRun(action: string): { token: number; signal: AbortSignal } {
  const previous = runs.get(action);
  if (previous && !previous.committed) previous.abort.abort();
  const run: Run = { token: ++lastToken, abort: new AbortController(), committed: false };
  runs.set(action, run);
  write(action, inPhase(undefined, "preparing"));
  return { token: run.token, signal: run.abort.signal };
}

export function isCurrentRun(action: string, token: number): boolean {
  return runs.get(action)?.token === token;
}

export function commitRun(action: string, token: number): void {
  const run = runs.get(action);
  if (run?.token === token) run.committed = true;
}

/** End a run; true when it was the action's current one, whose slot it clears. */
export function endRun(action: string, token: number): boolean {
  if (!isCurrentRun(action, token)) return false;
  runs.delete(action);
  write(action, null);
  return true;
}

/** Stop the uploads of the action's run; false once its job is on its way, or when none runs. */
export function cancelAction(action: string): boolean {
  const run = runs.get(action);
  if (!run || run.committed) return false;
  run.abort.abort();
  return true;
}

export function setRunPhase(action: string, token: number, phase: SubmitPhase): void {
  if (!isCurrentRun(action, token)) return;
  write(action, inPhase(useSubmitProgress.getState().byAction[action], phase));
}

/** A batch's report, written when what a slot shows changed. Once the run's
 * job is on its way its slot says so, and a resend at the post leaves it. */
export function setRunProgress(action: string, token: number, report: BatchProgress): void {
  const run = runs.get(action);
  if (run?.token !== token || run.committed) return;
  const current = useSubmitProgress.getState().byAction[action];
  const next = advance(current, report, Date.now());
  if (next !== current) write(action, next);
}
