// One level of undo for the input list and restores: the last change worth
// undoing is offered in its notice, and runs from the notice's button or
// Ctrl+Z while the notice shows.

import { toast } from "sonner";
import { UNDO_FAILED } from "@/lib/inputs/text";
import { failureText } from "./quota";

interface Pending {
  id: number;
  run: () => Promise<void> | void;
  /** The offer ended without its undo running. */
  settle: (() => void) | undefined;
  holds: (() => Iterable<string>) | undefined;
}

export interface OfferOptions {
  /** Runs once the offer ends without Undo: the notice closed, or another
   * offer took its place. */
  settle?: () => void;
  /** The cids of what Undo would put back, whose bytes must stay while it can. */
  holds?: () => Iterable<string>;
  /** The change has not landed yet: the title says what it waits on, with
   * Cancel, until `update` says it landed. */
  waiting?: boolean;
}

const TOAST_ID = "inputs-undo";
const DURATION_MS = 8000;

let pending: Pending | null = null;
let counter = 0;

/** An offer still showing: what it says can change, and it can be taken back. */
export interface UndoOffer {
  /** Change what the notice says; its Undo stays. */
  update(title: string, description: string | null): void;
  /** Nothing to undo after all: the notice goes. */
  withdraw(): void;
  /** The change waits on bytes: the notice says how far, with Cancel, until
   * `update` says it landed. Cancel, the notice's Undo and Ctrl+Z run the
   * undo, which stops the wait. Shown at most once a second. */
  progress(text: string): void;
}

const PROGRESS_EVERY_MS = 1000;

/** Say what was done and offer to undo it. A new offer replaces the pending one. */
export function offerUndo(
  title: string,
  description: string | null,
  undo: () => Promise<void> | void,
  { settle, holds, waiting = false }: OfferOptions = {},
): UndoOffer {
  const id = ++counter;
  const replaced = pending;
  pending = { id, run: undo, settle, holds };
  replaced?.settle?.();
  const forget = () => {
    if (pending?.id !== id) return;
    pending = null;
    settle?.();
  };
  const show = (text: string, detail: string | null) =>
    toast(text, {
      id: TOAST_ID,
      description: detail ?? undefined,
      duration: DURATION_MS,
      action: { label: "Undo", onClick: () => void runUndo() },
      onDismiss: forget,
      onAutoClose: forget,
    });
  // a wait cannot be swiped away: its Undo would be lost with it
  const wait = (text: string) =>
    toast(text, {
      id: TOAST_ID,
      description: undefined,
      duration: Infinity,
      dismissible: false,
      action: { label: "Cancel", onClick: () => void runUndo() },
    });
  if (waiting) wait(title);
  else show(title, description);
  let shownAt = 0;
  return {
    update: (text, detail) => {
      if (pending?.id === id) show(text, detail);
    },
    progress: (text) => {
      const now = Date.now();
      if (pending?.id !== id || now - shownAt < PROGRESS_EVERY_MS) return;
      shownAt = now;
      wait(text);
    },
    withdraw: () => {
      if (pending?.id !== id) return;
      pending = null;
      toast.dismiss(TOAST_ID);
    },
  };
}

/** The cids the pending Undo would put back. */
export function undoHolds(): string[] {
  return pending?.holds ? [...pending.holds()] : [];
}

/** Run the pending undo; false when there is none. An undo that fails says
 * so, and what it would have undone stands. */
export async function runUndo(): Promise<boolean> {
  const current = pending;
  if (!current) return false;
  pending = null;
  toast.dismiss(TOAST_ID);
  try {
    await current.run();
  } catch (err) {
    console.error("[inputs] could not undo", err);
    toast.error(UNDO_FAILED, { description: failureText(err) });
  }
  return true;
}
