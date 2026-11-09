// Tabs that cannot count each other (a page served over plain http has no Web
// Locks) learn of a reset over a channel: they stop writing when it starts and
// reload when it is done, or on their own after a while.

import { freezeProfile, profileFrozen } from "./freeze";

const NAME = "enso-reset";
const RELOAD_AFTER_MS = 30_000;

type Message = { type: "start" } | { type: "done" };

let channel: BroadcastChannel | null = null;

function open(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  channel ??= new BroadcastChannel(NAME);
  return channel;
}

/** Listen for resets other tabs run. A channel never hears its own messages,
 * so this page is not frozen by the ones it sends. */
export function listenForResets(): void {
  const listening = open();
  if (!listening || listening.onmessage) return;
  listening.onmessage = (event: MessageEvent<Message>) => {
    if (event.data.type === "start") {
      freezeProfile();
      setTimeout(() => window.location.reload(), RELOAD_AFTER_MS);
    } else if (event.data.type === "done" && profileFrozen()) {
      window.location.reload();
    }
  };
}

export function announceStart(): void {
  open()?.postMessage({ type: "start" } satisfies Message);
}

export function announceDone(): void {
  open()?.postMessage({ type: "done" } satisfies Message);
}
