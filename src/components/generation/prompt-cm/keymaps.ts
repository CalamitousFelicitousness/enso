import { type EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { loraWidgetPlugin } from "./loraWidget";

/** Find the (text:weight) group enclosing `pos`, if any. */
function findEnclosingWeight(
  doc: string,
  pos: number,
): { from: number; to: number; text: string; weight: number } | null {
  // Search backward for opening paren
  let depth = 0;
  let openIdx = -1;
  for (let i = pos - 1; i >= 0; i--) {
    if (doc[i] === ")") depth++;
    if (doc[i] === "(") {
      if (depth === 0) {
        openIdx = i;
        break;
      }
      depth--;
    }
  }
  if (openIdx < 0) return null;

  // Search forward for closing paren
  depth = 0;
  let closeIdx = -1;
  for (let i = pos; i < doc.length; i++) {
    if (doc[i] === "(") depth++;
    if (doc[i] === ")") {
      if (depth === 0) {
        closeIdx = i;
        break;
      }
      depth--;
    }
  }
  if (closeIdx < 0) return null;

  const inner = doc.slice(openIdx + 1, closeIdx);
  const lastColon = inner.lastIndexOf(":");
  if (lastColon < 0) return null;

  const weight = parseFloat(inner.slice(lastColon + 1));
  if (isNaN(weight)) return null;

  return {
    from: openIdx,
    to: closeIdx + 1,
    text: inner.slice(0, lastColon),
    weight,
  };
}

/** Find the word (non-separator run) touching `pos`. */
function findWordAt(
  doc: string,
  pos: number,
): { from: number; to: number } | null {
  const sep = /[\s.,():<>]/;
  if (pos > 0 && pos < doc.length && sep.test(doc[pos]) && !sep.test(doc[pos - 1])) {
    // Cursor is right after the word — expand left
  } else if (pos < doc.length && sep.test(doc[pos]) && (pos === 0 || sep.test(doc[pos - 1]))) {
    return null;
  }
  let from = pos;
  let to = pos;
  while (from > 0 && !sep.test(doc[from - 1])) from--;
  while (to < doc.length && !sep.test(doc[to])) to++;
  if (from === to) return null;
  return { from, to };
}

function adjustWeight(view: EditorView, delta: number): boolean {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc.toString();

  if (from !== to) {
    // Selection: wrap or adjust the selected range
    const selected = doc.slice(from, to);
    const match = selected.match(/^\((.+):([0-9.]+)\)$/);

    if (match) {
      const w = Math.max(0, Math.min(2, parseFloat(match[2]) + delta));
      if (Math.abs(w - 1.0) < 0.001) {
        // Unwrap at 1.0 — select the inner text so user can adjust back
        view.dispatch({
          changes: { from, to, insert: match[1] },
          selection: { anchor: from, head: from + match[1].length },
        });
      } else {
        const replacement = `(${match[1]}:${w.toFixed(1)})`;
        view.dispatch({
          changes: { from, to, insert: replacement },
          selection: { anchor: from, head: from + replacement.length },
        });
      }
    } else {
      const w = Math.max(0, Math.min(2, 1.0 + delta));
      const replacement = `(${selected}:${w.toFixed(1)})`;
      view.dispatch({
        changes: { from, to, insert: replacement },
        selection: { anchor: from, head: from + replacement.length },
      });
    }
    return true;
  }

  // No selection — check if cursor is inside (text:weight)
  const enclosing = findEnclosingWeight(doc, from);
  if (enclosing) {
    const w = Math.max(0, Math.min(2, enclosing.weight + delta));
    if (Math.abs(w - 1.0) < 0.001) {
      // Unwrap at 1.0 — select the inner text so user can adjust back
      view.dispatch({
        changes: { from: enclosing.from, to: enclosing.to, insert: enclosing.text },
        selection: { anchor: enclosing.from, head: enclosing.from + enclosing.text.length },
      });
    } else {
      const replacement = `(${enclosing.text}:${w.toFixed(1)})`;
      view.dispatch({
        changes: { from: enclosing.from, to: enclosing.to, insert: replacement },
        selection: { anchor: from },
      });
    }
    return true;
  }

  // No selection, no enclosing parens — wrap the word under cursor
  const word = findWordAt(doc, from);
  if (word) {
    const text = doc.slice(word.from, word.to);
    const w = Math.max(0, Math.min(2, 1.0 + delta));
    const replacement = `(${text}:${w.toFixed(1)})`;
    view.dispatch({
      changes: { from: word.from, to: word.to, insert: replacement },
      selection: { anchor: word.from, head: word.from + replacement.length },
    });
    return true;
  }

  return false;
}

/** Find a chip decoration ending at `pos` (for backspace / left arrow). */
function chipEndingAt(view: EditorView, pos: number): { from: number; to: number } | null {
  const plugin = view.plugin(loraWidgetPlugin);
  if (!plugin) return null;
  const iter = plugin.decorations.iter();
  while (iter.value) {
    if (iter.to === pos) return { from: iter.from, to: iter.to };
    if (iter.from > pos) break;
    iter.next();
  }
  return null;
}

/** Find a chip decoration starting at `pos` (for delete / right arrow). */
function chipStartingAt(view: EditorView, pos: number): { from: number; to: number } | null {
  const plugin = view.plugin(loraWidgetPlugin);
  if (!plugin) return null;
  const iter = plugin.decorations.iter();
  while (iter.value) {
    if (iter.from === pos) return { from: iter.from, to: iter.to };
    if (iter.from > pos) break;
    iter.next();
  }
  return null;
}

function deleteChipBackward(view: EditorView): boolean {
  const { from, to, head } = view.state.selection.main;
  if (from !== to) return false;
  const chip = chipEndingAt(view, head);
  if (!chip) return false;
  view.dispatch({ changes: { from: chip.from, to: chip.to } });
  return true;
}

function deleteChipForward(view: EditorView): boolean {
  const { from, to, head } = view.state.selection.main;
  if (from !== to) return false;
  const chip = chipStartingAt(view, head);
  if (!chip) return false;
  view.dispatch({ changes: { from: chip.from, to: chip.to } });
  return true;
}

function skipChipLeft(view: EditorView): boolean {
  const { from, to, head } = view.state.selection.main;
  if (from !== to) return false;
  const chip = chipEndingAt(view, head);
  if (!chip) return false;
  view.dispatch({ selection: { anchor: chip.from } });
  return true;
}

function skipChipRight(view: EditorView): boolean {
  const { from, to, head } = view.state.selection.main;
  if (from !== to) return false;
  const chip = chipStartingAt(view, head);
  if (!chip) return false;
  view.dispatch({ selection: { anchor: chip.to } });
  return true;
}

export const promptKeymap = Prec.high(keymap.of([
  { key: "Backspace", run: deleteChipBackward },
  { key: "Delete", run: deleteChipForward },
  { key: "ArrowLeft", run: skipChipLeft },
  { key: "ArrowRight", run: skipChipRight },
  { key: "Ctrl-ArrowUp", run: (view) => adjustWeight(view, 0.1) },
  { key: "Ctrl-ArrowDown", run: (view) => adjustWeight(view, -0.1) },
]));
