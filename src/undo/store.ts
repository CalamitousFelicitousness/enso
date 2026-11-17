// What Undo and Redo would do in the view on screen, worded by the function
// that plans the press, so the Top Bar and the press cannot disagree.

import { create } from "zustand";
import { formatShortcut, SHORTCUTS } from "@/lib/shortcuts";
import {
  cancelTitle,
  NOTHING_TO_REDO,
  NOTHING_TO_UNDO,
  redoTitle,
  undoTitle,
} from "@/lib/undo/text";
import { useUiStore } from "@/stores/uiStore";
import type { PressKind, Undo } from "./service";

export interface UndoOffer {
  /** The button's tooltip and accessible name. */
  readonly label: string;
  readonly enabled: boolean;
}

interface UndoView {
  readonly undo: UndoOffer;
  readonly redo: UndoOffer;
  /** A press is running: the buttons say so without changing size. */
  readonly busy: boolean;
}

const keysOf = (id: string): string | null => {
  const def = SHORTCUTS[id];
  return def ? formatShortcut(def) : null;
};

export const useUndo = create<UndoView>()(() => ({
  undo: { label: NOTHING_TO_UNDO, enabled: false },
  redo: { label: NOTHING_TO_REDO, enabled: false },
  busy: false,
}));

function offer(history: Undo, kind: PressKind): UndoOffer {
  const view = useUiStore.getState().activeNavView;
  const action = history.next(kind);
  switch (action.kind) {
    case "none":
      return { label: kind === "undo" ? NOTHING_TO_UNDO : NOTHING_TO_REDO, enabled: false };
    case "cancel": {
      const name = history.waitName(action.wait.id);
      return { label: cancelTitle(name ?? { kind: "command" }, keysOf("undo")), enabled: true };
    }
    case "replay":
    case "editor":
    case "release":
      return kind === "undo"
        ? { label: undoTitle(action.step, view, keysOf("undo")), enabled: true }
        : { label: redoTitle(action.step, view, keysOf("redo")), enabled: true };
  }
}

/** Keep `useUndo` on the history and the view; returns the stop. */
export function followUndo(history: Undo): () => void {
  const update = () =>
    useUndo.setState({
      undo: offer(history, "undo"),
      redo: offer(history, "redo"),
      busy: history.busy(),
    });
  update();
  const offHistory = history.subscribe(update);
  const offView = useUiStore.subscribe((s, previous) => {
    if (s.activeNavView !== previous.activeNavView) update();
  });
  return () => {
    offHistory();
    offView();
  };
}
