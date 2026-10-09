// Storage running out. Every writer says so the same way, as one notice,
// since the quota is the origin's; what could not be stored is tried again
// once a deletion from the trash has freed space.

import { reportStorageProblem } from "@/lib/storageHealth";
import { STORAGE_FULL } from "@/lib/inputs/text";

export const FULL_ID = "storage-full";

/** Whether an error, or what caused it, says the origin's storage is full. */
export function isQuotaError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "QuotaExceededError") return true;
  return err instanceof Error && err.cause !== undefined && isQuotaError(err.cause);
}

/** Why something could not be stored, as a notice's second line says it. */
export function failureText(err: unknown): string {
  if (isQuotaError(err)) return STORAGE_FULL;
  return err instanceof Error ? err.message : String(err);
}

const retries = new Set<() => void>();

/** The wait before each retry pass once space is freed. The browser deletes
 * a blob's file only once no handle read from it is left, and a page lets go
 * of the handles it read when they are garbage collected, so the space comes
 * back a while after the delete. */
const PASS_DELAYS_MS = [0, 1_000, 3_000, 10_000, 30_000, 60_000];

/** Set while retry passes run: what the latest refused write was. */
let settling: { what: string | null } | null = null;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Say storage is full: `what` could not be stored. `retry` runs once space
 * is freed; while retry passes run, the notice waits for them. */
export function reportFull(what: string, retry?: () => void): void {
  if (retry) retries.add(retry);
  if (settling) settling.what = what;
  else reportStorageProblem({ kind: "full", id: FULL_ID, what });
}

/** Write handlers for a persisted store: a full disk goes to the one notice
 * and is tried again once space is freed, any other failure to the store's
 * own notice. */
export function writeProblems(id: string, what: string, retry: () => void) {
  return {
    onWriteError: (error: unknown) => {
      if (isQuotaError(error)) reportFull(`Changes to the ${what}`, retry);
      else reportStorageProblem({ kind: "write", id, what });
    },
    onWriteRecovered: () => {
      reportStorageProblem({ kind: "resolved", id });
      reportStorageProblem({ kind: "resolved", id: FULL_ID });
    },
  };
}

/** Space was freed: take the notice down and try again what could not be
 * stored, pass by pass until nothing is refused or the passes run out. A
 * write refused after the last pass brings the notice back. */
export function spaceFreed(): void {
  reportStorageProblem({ kind: "resolved", id: FULL_ID });
  if (settling) return;
  const state: { what: string | null } = { what: null };
  settling = state;
  void (async () => {
    for (const wait of PASS_DELAYS_MS) {
      await delay(wait);
      if (wait > 0 && retries.size === 0 && state.what === null) break;
      state.what = null;
      const pending = [...retries];
      retries.clear();
      for (const retry of pending) retry();
    }
    settling = null;
    // refused during the last pass, before it ended
    if (state.what !== null) reportStorageProblem({ kind: "full", id: FULL_ID, what: state.what });
  })();
}
