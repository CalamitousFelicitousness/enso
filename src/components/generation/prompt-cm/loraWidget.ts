import {
  ViewPlugin,
  Decoration,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
  type EditorView,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { TOKEN_PATTERN } from "./facets";

// ── LoRA chip widget ─────────────────────────────────────────────────

class LoraChipWidget extends WidgetType {
  displayName: string;
  weight: string;
  fullRaw: string;
  from: number;
  to: number;
  private getView: () => EditorView;

  constructor(
    displayName: string,
    weight: string,
    fullRaw: string,
    from: number,
    to: number,
    getView: () => EditorView,
  ) {
    super();
    this.displayName = displayName;
    this.weight = weight;
    this.fullRaw = fullRaw;
    this.from = from;
    this.to = to;
    this.getView = getView;
  }

  eq(other: LoraChipWidget): boolean {
    return this.fullRaw === other.fullRaw;
  }

  toDOM(): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "cm-lora-chip";
    chip.textContent = this.displayName;

    const weightSpan = document.createElement("span");
    weightSpan.className = "cm-lora-chip-weight";
    weightSpan.textContent = this.weight;
    chip.appendChild(weightSpan);

    // Scroll wheel on chip adjusts weight
    chip.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.05 : -0.05;
        this.updateWeight(delta);
      },
      { passive: false },
    );

    // Click on weight span shows slider
    weightSpan.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showWeightSlider(weightSpan);
    });

    return chip;
  }

  ignoreEvent(): boolean {
    return false;
  }

  private updateWeight(delta: number) {
    const view = this.getView();
    const raw = view.state.sliceDoc(this.from, this.to);
    const lastColon = raw.lastIndexOf(":");
    const closeBracket = raw.lastIndexOf(">");
    if (lastColon < 0 || closeBracket < 0) return;

    const currentWeight = parseFloat(raw.slice(lastColon + 1, closeBracket));
    const newWeight = Math.max(0, Math.min(2, currentWeight + delta));

    view.dispatch({
      changes: {
        from: this.from + lastColon + 1,
        to: this.from + closeBracket,
        insert: newWeight.toFixed(2),
      },
    });
  }

  private showWeightSlider(anchor: HTMLElement) {
    const view = this.getView();
    const raw = view.state.sliceDoc(this.from, this.to);
    const lastColon = raw.lastIndexOf(":");
    const closeBracket = raw.lastIndexOf(">");
    if (lastColon < 0 || closeBracket < 0) return;

    const currentWeight = parseFloat(raw.slice(lastColon + 1, closeBracket));

    const popover = document.createElement("div");
    popover.className = "cm-weight-slider";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "2";
    slider.step = "0.05";
    slider.value = String(currentWeight);

    const label = document.createElement("span");
    label.className = "cm-weight-slider-label";
    label.textContent = currentWeight.toFixed(2);

    slider.addEventListener("input", () => {
      const val = parseFloat(slider.value);
      label.textContent = val.toFixed(2);
      const freshRaw = view.state.sliceDoc(this.from, this.to);
      const freshLastColon = freshRaw.lastIndexOf(":");
      const freshClose = freshRaw.lastIndexOf(">");
      if (freshLastColon >= 0 && freshClose >= 0) {
        view.dispatch({
          changes: {
            from: this.from + freshLastColon + 1,
            to: this.from + freshClose,
            insert: val.toFixed(2),
          },
        });
      }
    });

    popover.appendChild(slider);
    popover.appendChild(label);

    const rect = anchor.getBoundingClientRect();
    popover.style.position = "fixed";
    popover.style.left = `${rect.left}px`;
    popover.style.top = `${rect.bottom + 4}px`;
    popover.style.zIndex = "1000";

    const dismiss = () => {
      popover.remove();
      document.removeEventListener("mousedown", outsideClick);
      document.removeEventListener("keydown", escKey);
    };
    const outsideClick = (e: MouseEvent) => {
      if (!popover.contains(e.target as Node)) dismiss();
    };
    const escKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };

    document.body.appendChild(popover);
    requestAnimationFrame(() => {
      document.addEventListener("mousedown", outsideClick);
      document.addEventListener("keydown", escKey);
    });
    slider.focus();
  }
}

// ── ViewPlugin: expand-on-cursor pattern ─────────────────────────────

export const loraWidgetPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      this.decorations = this.build();
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) {
        this.view = update.view;
        this.decorations = this.build();
      }
    }

    private build(): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      const text = this.view.state.doc.toString();
      const cursorHead = this.view.state.selection.main.head;

      const matches: Array<{
        from: number;
        to: number;
        displayName: string;
        weight: string;
        raw: string;
      }> = [];

      for (const match of text.matchAll(new RegExp(TOKEN_PATTERN, "g"))) {
        if (match[1] === undefined) continue;
        const tagType = match[1].toLowerCase();
        if (tagType !== "lora" && tagType !== "lyco") continue;

        const from = match.index!;
        const to = from + match[0].length;
        const args = match[2];
        const lastColon = args.lastIndexOf(":");
        const name = lastColon > 0 ? args.slice(0, lastColon) : args;
        const weight = lastColon > 0 ? args.slice(lastColon + 1) : "1";
        const displayName = name.split("/").pop() || name;

        matches.push({ from, to, displayName, weight, raw: match[0] });
      }

      for (const m of matches) {
        if (cursorHead >= m.from && cursorHead <= m.to) continue;
        builder.add(
          m.from,
          m.to,
          Decoration.replace({
            widget: new LoraChipWidget(
              m.displayName,
              m.weight,
              m.raw,
              m.from,
              m.to,
              () => this.view,
            ),
          }),
        );
      }

      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);
