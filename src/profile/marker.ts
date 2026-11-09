// The first-run marker, judged at page start before any store exists.

import { firstRunState } from "@/lib/profile/firstRun";
import { LOCAL } from "@/lib/profile/names";
import { localKeys, readLocal, writeLocal } from "./local";

let firstRun = false;

export function startProfile(): void {
  const state = firstRunState(readLocal(LOCAL.profile), localKeys());
  if (state !== "marked") writeLocal(LOCAL.profile, String(Date.now()));
  firstRun = state === "first";
}

/** Nothing of Enso was kept in this browser when the page started. */
export function profileFirstRun(): boolean {
  return firstRun;
}
