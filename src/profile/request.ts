// The page that asks for a reset deletes nothing: it ends the sign-in when
// asked, writes the request and reloads. The next page start carries it out
// before any store exists (boot.ts).

import { api } from "@/api/client";
import { endSession } from "@/api/session";
import type { ResetGate } from "@/lib/profile/gate";
import { gateRefuses } from "@/lib/profile/gate";
import type { ResetRow } from "@/lib/profile/manifest";
import { LOCAL } from "@/lib/profile/names";
import { writeResetRecord, type ResetNote } from "@/lib/profile/record";
import { announceStart } from "./channel";
import { resetGate } from "./gate";
import { readLocal, writeLocal } from "./local";

const SESSION_WAIT_MS = 5_000;
/** Time for tabs that cannot be counted to hear the announcement and stop writing. */
const FREEZE_WAIT_MS = 300;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let resetting = false;

/** The page is reloading into a reset: nothing should hold the unload. */
export function isResetting(): boolean {
  return resetting;
}

export type ResetRefusal =
  | { kind: "gate"; gate: ResetGate }
  /** localStorage refused the request. */
  | { kind: "unstored" };

/** Ask for a reset of `rows`. Resolves with the refusal when nothing was
 * asked; otherwise the page reloads and the promise does not settle. */
export async function requestReset(rows: readonly ResetRow[]): Promise<ResetRefusal> {
  const gate = await resetGate();
  if (gateRefuses(gate)) return { kind: "gate", gate };

  const at = Date.now();
  const store = (notes: ResetNote[]): boolean => {
    const record = writeResetRecord({ state: "pending", rows: [...rows], notes, at });
    writeLocal(LOCAL.reset, record);
    return readLocal(LOCAL.reset) === record;
  };
  // stored before the sign-in ends, so a refusal leaves this page as it was
  if (!store([])) return { kind: "unstored" };

  if (rows.includes("connection")) {
    // credentials gone first, so no refused load or renewal mints a new session
    api.clearAuth();
    const ended = await endSession(AbortSignal.timeout(SESSION_WAIT_MS));
    if (!ended) store(["session"]);
  }

  if (gate.kind === "uncounted") {
    announceStart();
    await sleep(FREEZE_WAIT_MS);
  }
  resetting = true;
  window.location.reload();
  return new Promise<never>(() => {});
}
