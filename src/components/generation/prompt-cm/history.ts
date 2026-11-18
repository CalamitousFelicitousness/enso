// The prompt editor's history. On the app's history, the editor's own
// CodeMirror history serves its typing run: each change it makes is recorded
// as typing, Undo and Redo pressed in it press the app's history, and the
// store's text reaches it as the smallest change with no entry of its own.
// An editor whose store the app's history does not record keeps its own
// history and keys.

import { history, historyKeymap, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { Annotation, Compartment, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { textChange } from "@/lib/textChange";
import type { TypingKind } from "@/lib/undo/stacks";
import { editorHidden, editorTyped, pressHistoryInput, pressHistoryKey } from "@/undo/editors";
import type { EditorHandle } from "@/undo/service";

/** A change from the store: already there, so not written back. */
const fromStore = Annotation.define<boolean>();

export interface PromptHistory {
  readonly extension: Extension;
  readonly attach: (view: EditorView) => void;
  readonly detach: () => void;
  /** Show the store's text. During a composition it waits for the end, and
   * what was composed meanwhile goes. */
  readonly write: (text: string) => void;
  /** The editor hid or is going away: its typing run closes. */
  readonly close: () => void;
}

/** `save` puts the editor's text in the store; with `own` the editor keeps
 * its own history and keys. */
export function promptHistory(own: boolean, save: (text: string) => void): PromptHistory {
  const compartment = new Compartment();
  let view: EditorView | null = null;
  /** The store's text, kept until a composition ends. */
  let held: string | null = null;
  /** In this editor's own update, where a dispatch must wait. */
  let updating = false;
  let resetAfter = false;

  const clear = () => {
    if (!view) return;
    view.dispatch({ effects: compartment.reconfigure([]) });
    view.dispatch({ effects: compartment.reconfigure(history()) });
  };

  const handle: EditorHandle = {
    undo: () => view !== null && undo(view),
    redo: () => view !== null && redo(view),
    undoDepth: () => (view ? undoDepth(view.state) : 0),
    redoDepth: () => (view ? redoDepth(view.state) : 0),
    reset: () => {
      if (updating) resetAfter = true;
      else clear();
    },
    text: () => view?.state.doc.toString() ?? "",
  };

  const show = (text: string) => {
    if (!view) return;
    const changes = textChange(view.state.doc.toString(), text);
    if (!changes) return;
    if (own) {
      view.dispatch({ changes, annotations: fromStore.of(true) });
      return;
    }
    // with the history taken out for the change, its own history holds no entry for it
    view.dispatch({
      changes,
      annotations: fromStore.of(true),
      effects: compartment.reconfigure([]),
    });
    view.dispatch({ effects: compartment.reconfigure(history()) });
  };

  const flush = () => {
    if (held === null || view?.compositionStarted) return;
    const text = held;
    held = null;
    show(text);
  };

  const typed = (kind: TypingKind, textAtOpen: string, text: string) => {
    updating = true;
    try {
      editorTyped(handle, kind, textAtOpen, () => save(text));
    } finally {
      updating = false;
    }
    if (resetAfter) {
      resetAfter = false;
      queueMicrotask(clear);
    }
  };

  const listener = EditorView.updateListener.of((update) => {
    if (held !== null) {
      // the store is the truth: what is composed meanwhile is not saved
      if (!update.view.compositionStarted) queueMicrotask(flush);
      return;
    }
    if (!update.docChanged || update.transactions.some((tr) => tr.annotation(fromStore))) return;
    const text = update.state.doc.toString();
    if (own) {
      save(text);
      return;
    }
    const by = (event: string) => update.transactions.some((tr) => tr.isUserEvent(event));
    const kind: TypingKind = by("undo") ? "undo" : by("redo") ? "redo" : "input";
    typed(kind, update.startState.doc.toString(), text);
  });

  // A held text shows when the composition ends, and before the next key where
  // a browser left the end unreported. Undo and redo while composing stay the
  // browser's, which takes back the composed text.
  const keys = Prec.highest(
    EditorView.domEventHandlers({
      compositionend: () => {
        queueMicrotask(flush);
        return false;
      },
      keydown: (e, v) => {
        flush();
        return !own && !v.composing && !e.isComposing && pressHistoryKey(e);
      },
      beforeinput: (e, v) => !own && !v.composing && !e.isComposing && pressHistoryInput(e),
    }),
  );

  return {
    extension: own
      ? [history(), keymap.of(historyKeymap), keys, listener]
      : [compartment.of(history()), keys, listener],
    attach: (next) => {
      view = next;
    },
    detach: () => {
      view = null;
      held = null;
    },
    write: (text) => {
      if (view?.compositionStarted) {
        held = text;
        return;
      }
      held = null;
      show(text);
    },
    close: () => {
      if (!own) editorHidden(handle);
    },
  };
}
