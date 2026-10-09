// One level of undo for the input list and restores: the last change worth
// undoing is offered in its notice, and runs from the notice's button or
// Ctrl+Z while the notice shows.

import { toast } from "sonner";

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
}

/** Say what was done and offer to undo it. A new offer replaces the pending one. */
export function offerUndo(
  title: string,
  description: string | null,
  undo: () => Promise<void> | void,
  { settle, holds }: OfferOptions = {},
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
  show(title, description);
  return {
    update: (text, detail) => {
      if (pending?.id === id) show(text, detail);
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

/** Run the pending undo; false when there is none. */
export async function runUndo(): Promise<boolean> {
  const current = pending;
  if (!current) return false;
  pending = null;
  toast.dismiss(TOAST_ID);
  await current.run();
  return true;
}
