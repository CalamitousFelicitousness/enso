import { EditorView } from "@codemirror/view";
import { setPromptCursor } from "@/lib/promptCursor";

export const cursorTracker = EditorView.updateListener.of((update) => {
  if (update.selectionSet) {
    setPromptCursor(update.state.selection.main.head);
  }
});
