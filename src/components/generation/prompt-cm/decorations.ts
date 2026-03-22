import {
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { TOKEN_PATTERN } from "./facets";

// Mark decorations for tokens NOT handled as chips by loraWidget.ts.
// LoRA, wildcard, and embedding tokens are rendered as replace-widgets there.
const styleMark = Decoration.mark({ class: "cm-tok-style" });
const attentionMark = Decoration.mark({ class: "cm-tok-attention" });
const dimMark = Decoration.mark({ class: "cm-tok-dim" });

type Deco = { from: number; to: number; mark: Decoration };

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const text = view.state.doc.toString();
  const decos: Deco[] = [];

  for (const match of text.matchAll(new RegExp(TOKEN_PATTERN, "g"))) {
    const from = match.index!;
    const to = from + match[0].length;

    if (match[1] !== undefined) {
      const tagType = match[1].toLowerCase();
      // LoRA/LyCo handled by chip widgets — only style gets marks here
      if (tagType === "style") {
        decos.push({ from, to, mark: styleMark });
        decos.push({ from, to: from + tagType.length + 2, mark: dimMark });
        decos.push({ from: to - 1, to, mark: dimMark });
      }
    } else if (match[4] !== undefined && match[5] !== undefined) {
      // Attention: (text:weight)
      decos.push({ from, to, mark: attentionMark });
      decos.push({ from, to: from + 1, mark: dimMark });
      const weightLen = match[5].length;
      decos.push({ from: to - 1 - weightLen, to, mark: dimMark });
    }
    // Wildcards (__name__) handled by chip widgets
  }

  decos.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const { from, to, mark } of decos) {
    builder.add(from, to, mark);
  }

  return builder.finish();
}

export const promptHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
