// Undo and Redo from the keys and the command palette, mounted once in
// AppShell. A modal dialog, the comparison and the tutorial hold them off;
// a notice's own buttons still work there.

import { Redo2, Undo2 } from "lucide-react";
import { useShortcut } from "@/hooks/useShortcut";
import { useRegisterCommand } from "@/lib/commandRegistry";
import { useTutorialStore } from "@/stores/tutorialStore";
import type { PressKind } from "./service";
import { startUndo } from "./start";

/** An open dialog's content, or an overlay that takes the whole page. */
const MODAL = '[data-slot="dialog-content"][data-state="open"], [role="dialog"][aria-modal="true"]';

export function undoBlocked(): boolean {
  return useTutorialStore.getState().active || document.querySelector(MODAL) !== null;
}

/** Undo or Redo the newest thing in reach of the view on screen. */
export function pressUndo(kind: PressKind): void {
  if (undoBlocked()) return;
  void startUndo().press(kind);
}

export function useUndoCommands(): void {
  useShortcut("undo", () => pressUndo("undo"));
  useShortcut("redo", () => pressUndo("redo"));
  useShortcut("redo-alt", () => pressUndo("redo"));
  useRegisterCommand({
    id: "actions:undo",
    label: "Undo the last change",
    group: "Actions",
    keywords: ["undo", "revert", "bring back", "removed", "step back"],
    icon: Undo2,
    shortcutId: "undo",
    run: () => pressUndo("undo"),
  });
  useRegisterCommand({
    id: "actions:redo",
    label: "Redo the last undone change",
    group: "Actions",
    keywords: ["redo", "again", "forward", "reapply"],
    icon: Redo2,
    shortcutId: "redo",
    run: () => pressUndo("redo"),
  });
}
