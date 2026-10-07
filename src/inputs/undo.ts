// One level of undo for the input list: the last change worth undoing is
// offered in its notice, and runs from the notice's button or Ctrl+Z while
// the notice shows.

import { toast } from "sonner";

interface Pending {
  id: number;
  run: () => Promise<void> | void;
}

const TOAST_ID = "inputs-undo";
const DURATION_MS = 8000;

let pending: Pending | null = null;
let counter = 0;

/** Say what was done and offer to undo it. A new offer replaces the pending one. */
export function offerUndo(
  title: string,
  description: string | null,
  undo: () => Promise<void> | void,
): void {
  const id = ++counter;
  pending = { id, run: undo };
  const forget = () => {
    if (pending?.id === id) pending = null;
  };
  toast(title, {
    id: TOAST_ID,
    description: description ?? undefined,
    duration: DURATION_MS,
    action: { label: "Undo", onClick: () => void runUndo() },
    onDismiss: forget,
    onAutoClose: forget,
  });
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
