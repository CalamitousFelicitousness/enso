// Undo and Redo pressed from a key, a menu or a button. A modal dialog, the
// comparison and the tutorial hold them off; a notice's own buttons still
// work there.

import { useTutorialStore } from "@/stores/tutorialStore";
import type { PressKind } from "./service";
import { startUndo } from "./start";

/** An open dialog's content, or an overlay that takes the whole page. */
const MODAL = '[data-slot="dialog-content"][data-state="open"], [role="dialog"][aria-modal="true"]';

export function undoBlocked(): boolean {
  return useTutorialStore.getState().active || document.querySelector(MODAL) !== null;
}

/** Undo or Redo the newest thing in reach of the view on screen; false when
 * the presses are held off. */
export function pressUndo(kind: PressKind): boolean {
  if (undoBlocked()) return false;
  void startUndo().press(kind);
  return true;
}
