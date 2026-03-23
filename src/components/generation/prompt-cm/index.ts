import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { promptTheme } from "./theme";
import { promptHighlighter } from "./decorations";
import { loraWidgetPlugin, loraDragDrop } from "./loraWidget";
import { promptTooltips } from "./tooltips";
import { cursorTracker } from "./cursor";
import { promptKeymap } from "./keymaps";

export {
  embeddingNamesFacet,
  loraNamesFacet,
  styleNamesFacet,
  wildcardNamesFacet,
  dictTagsFacet,
} from "./facets";

export { promptAutocomplete } from "./autocomplete";

export function promptExtensions(placeholderText?: string): Extension[] {
  return [
    keymap.of(defaultKeymap),
    keymap.of(historyKeymap),
    history(),
    promptTheme,
    bracketMatching({ brackets: "()[]{}" }),
    promptHighlighter,
    loraWidgetPlugin,
    loraDragDrop,
    promptTooltips(),
    cursorTracker,
    promptKeymap,
    EditorView.lineWrapping,
    placeholderText ? cmPlaceholder(placeholderText) : [],
  ];
}
