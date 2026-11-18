// Text fields on the undo history. A prompt editor's own changes make its
// typing run, which the editor's own history serves; Undo and Redo pressed in
// a text field press the app's history, unless the field undoes typing the
// history does not hold.

import { historyKey, isTextEntry } from "@/lib/shortcuts";
import type { TypingKind } from "@/lib/undo/stacks";
import { pressUndo } from "./press";
import type { EditorHandle, PressKind } from "./service";
import { startUndo } from "./start";

/** A prompt editor changed its own text; `write` puts it in the store. */
export function editorTyped(
  editor: EditorHandle,
  kind: TypingKind,
  textAtOpen: string,
  write: () => void,
): void {
  startUndo().typing(editor, kind, textAtOpen, write);
}

/** A prompt editor hid or is going away: its typing run closes. */
export function editorHidden(editor: EditorHandle): void {
  startUndo().closeTyping(editor);
}

/** Press Undo or Redo for a history key; false for any other key, and while
 * the presses are held off, when the key stays the field's own. */
export function pressHistoryKey(e: KeyboardEvent): boolean {
  const kind = historyKey(e);
  if (!kind || !pressUndo(kind)) return false;
  e.preventDefault();
  return true;
}

/** Press Undo or Redo for an Edit menu's or a context menu's history input;
 * false for any other input, for one the browser will not let go of, and
 * while the presses are held off. */
export function pressHistoryInput(e: InputEvent): boolean {
  const kind: PressKind | null =
    e.inputType === "historyUndo" ? "undo" : e.inputType === "historyRedo" ? "redo" : null;
  if (!kind || !e.cancelable || !pressUndo(kind)) return false;
  e.preventDefault();
  return true;
}

/** An input or textarea that takes typing; the prompt editors route their own keys. */
function nativeTextField(target: EventTarget | null): target is HTMLElement {
  return (
    (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
    isTextEntry(target)
  );
}

/** The field undoes its own typing: a draft that differs from what is
 * committed (`data-drafting`), or typing the history never recorded. */
function keepsOwnUndo(field: HTMLElement): boolean {
  return field.hasAttribute("data-drafting") || startUndo().typedUnrecorded(field);
}

/** Undo and Redo pressed in a native text field press the app's history,
 * the browser's own undo left to the field that keeps it. Returns the stop. */
export function routeTextFields(win: Window = window): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || !nativeTextField(e.target)) return;
    if (historyKey(e) && !keepsOwnUndo(e.target)) pressHistoryKey(e);
  };
  const onInput = (e: InputEvent) => {
    if (e.defaultPrevented || e.isComposing || !nativeTextField(e.target)) return;
    if (!keepsOwnUndo(e.target)) pressHistoryInput(e);
  };
  win.addEventListener("keydown", onKey);
  win.addEventListener("beforeinput", onInput);
  return () => {
    win.removeEventListener("keydown", onKey);
    win.removeEventListener("beforeinput", onInput);
  };
}
