import {
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { TOKEN_PATTERN, embeddingNamesFacet } from "./facets";

const loraMark = Decoration.mark({ class: "cm-tok-lora" });
const styleMark = Decoration.mark({ class: "cm-tok-style" });
const wildcardMark = Decoration.mark({ class: "cm-tok-wildcard" });
const attentionMark = Decoration.mark({ class: "cm-tok-attention" });
const embeddingMark = Decoration.mark({ class: "cm-tok-embedding" });
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
      const args = match[2];

      if (tagType === "lora" || tagType === "lyco") {
        decos.push({ from, to, mark: loraMark });
        const prefixEnd = from + tagType.length + 2;
        decos.push({ from, to: prefixEnd, mark: dimMark });
        decos.push({ from: to - 1, to, mark: dimMark });
        const lastColon = args.lastIndexOf(":");
        if (lastColon > 0) {
          decos.push({
            from: from + tagType.length + 2 + lastColon,
            to: to - 1,
            mark: dimMark,
          });
        }
      } else if (tagType === "style") {
        decos.push({ from, to, mark: styleMark });
        decos.push({ from, to: from + tagType.length + 2, mark: dimMark });
        decos.push({ from: to - 1, to, mark: dimMark });
      }
    } else if (match[3] !== undefined) {
      decos.push({ from, to, mark: wildcardMark });
      decos.push({ from, to: from + 2, mark: dimMark });
      decos.push({ from: to - 2, to, mark: dimMark });
    } else if (match[4] !== undefined && match[5] !== undefined) {
      decos.push({ from, to, mark: attentionMark });
      decos.push({ from, to: from + 1, mark: dimMark });
      const weightLen = match[5].length;
      decos.push({ from: to - 1 - weightLen, to, mark: dimMark });
    }
  }

  // Embedding detection
  const embeddings = view.state.facet(embeddingNamesFacet);
  if (embeddings.length > 0) {
    const sorted = [...embeddings].sort((a, b) => b.length - a.length);
    const escaped = sorted.map((n) =>
      n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    const re = new RegExp(
      `(?<=^|[\\s,])(?:${escaped.join("|")})(?=[\\s,]|$)`,
      "g",
    );
    for (const m of text.matchAll(re)) {
      decos.push({
        from: m.index!,
        to: m.index! + m[0].length,
        mark: embeddingMark,
      });
    }
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
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.startState.facet(embeddingNamesFacet) !==
          update.state.facet(embeddingNamesFacet)
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
