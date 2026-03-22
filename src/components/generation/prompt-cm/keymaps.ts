import { type EditorView, keymap } from "@codemirror/view";

function adjustWeight(view: EditorView, delta: number): boolean {
  const { from, to } = view.state.selection.main;
  if (from === to) return false;

  const selected = view.state.sliceDoc(from, to);
  const match = selected.match(/^\((.+):([0-9.]+)\)$/);

  let replacement: string;
  if (match) {
    const w = Math.max(0, Math.min(2, parseFloat(match[2]) + delta));
    replacement = `(${match[1]}:${w.toFixed(1)})`;
  } else {
    const w = Math.max(0, Math.min(2, 1.0 + delta));
    replacement = `(${selected}:${w.toFixed(1)})`;
  }

  view.dispatch({
    changes: { from, to, insert: replacement },
    selection: { anchor: from, head: from + replacement.length },
  });
  return true;
}

export const promptKeymap = keymap.of([
  { key: "Ctrl-ArrowUp", run: (view) => adjustWeight(view, 0.1) },
  { key: "Ctrl-ArrowDown", run: (view) => adjustWeight(view, -0.1) },
]);
