// The limits of the undo history: steps per stack, and bytes that only the
// history still names. A mask step holds well under a megabyte, so the bytes
// are removed and replaced pictures.

import { allSteps } from "./stacks";
import { SCOPES, type Change, type Scope, type Stack, type Stacks, type Step } from "./types";

export const STEP_LIMIT = 200;
export const BYTE_BUDGET = 512 * 1024 * 1024;

function sizes(steps: readonly Step[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const step of steps) {
    for (const [cid, bytes] of step.cids) out.set(cid, Math.max(bytes, out.get(cid) ?? 0));
  }
  return out;
}

/** Bytes the steps name that no document names: each cid counted once. */
export function undoBytes(stacks: Stacks, named: ReadonlySet<string>): number {
  let total = 0;
  for (const [cid, bytes] of sizes(allSteps(stacks))) if (!named.has(cid)) total += bytes;
  return total;
}

function counts(steps: readonly Step[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const step of steps)
    for (const cid of step.cids.keys()) out.set(cid, (out.get(cid) ?? 0) + 1);
  return out;
}

interface Run {
  readonly scope: Scope;
  readonly side: "undo" | "redo";
  readonly length: number;
  readonly first: number;
}

/** The shortest run from a side's far end, never its top, whose steps alone name
 * bytes no document names. */
function shortestRun(
  stacks: Stacks,
  side: "undo" | "redo",
  total: ReadonlyMap<string, number>,
  bytes: ReadonlyMap<string, number>,
  named: ReadonlySet<string>,
): Run | null {
  let best: Run | null = null;
  for (const scope of SCOPES) {
    const steps = stacks.byScope[scope][side];
    const inRun = new Map<string, number>();
    for (let length = 1; length < steps.length; length++) {
      let frees = false;
      // a cid frees once the last step naming it joins the run
      for (const cid of steps[length - 1].cids.keys()) {
        const n = (inRun.get(cid) ?? 0) + 1;
        inRun.set(cid, n);
        if (n === total.get(cid) && !named.has(cid) && (bytes.get(cid) ?? 0) > 0) frees = true;
      }
      if (!frees) continue;
      const run = { scope, side, length, first: steps[0].id };
      if (!best || length < best.length || (length === best.length && run.first < best.first)) {
        best = run;
      }
      break;
    }
  }
  return best;
}

/** Over the budget, the shortest runs of oldest undo-side steps that free bytes
 * go, then runs from the far end of redo sides; never a side's top. It stops
 * when no run frees bytes, so one step may stay over the budget. */
export function evict(stacks: Stacks, named: ReadonlySet<string>, budget: number): Change {
  let current = stacks;
  const dropped: Step[] = [];
  while (undoBytes(current, named) > budget) {
    const steps = allSteps(current);
    const total = counts(steps);
    const bytes = sizes(steps);
    const run =
      shortestRun(current, "undo", total, bytes, named) ??
      shortestRun(current, "redo", total, bytes, named);
    if (!run) break;
    const stack = current.byScope[run.scope];
    dropped.push(...stack[run.side].slice(0, run.length));
    const next: Stack = { ...stack, [run.side]: stack[run.side].slice(run.length) };
    current = { ...current, byScope: { ...current.byScope, [run.scope]: next } };
  }
  return { stacks: current, dropped };
}
