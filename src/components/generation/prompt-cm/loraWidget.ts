import {
  ViewPlugin,
  Decoration,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
  EditorView,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { TOKEN_PATTERN, embeddingNamesFacet } from "./facets";

const DRAG_MIME = "application/x-cm-chip";

// Suppress widget rebuilds while interacting with a chip. Held for the
// full drag lifecycle (mousedown → dragend) so the DOM element survives.
let rebuildLock = false;

// ── Shared drag helpers ──────────────────────────────────────────────

function setupDrag(
  chip: HTMLElement,
  from: number,
  to: number,
  raw: string,
  getView: () => EditorView,
) {
  chip.draggable = true;
  chip.addEventListener("mousedown", () => {
    rebuildLock = true;
  });
  // click fires on mouseup when no drag occurred — clears the lock
  chip.addEventListener("click", () => {
    rebuildLock = false;
  });
  chip.addEventListener("dragstart", (e) => {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ from, to, raw }));
    chip.classList.add("cm-chip-source");
    getView().dom.classList.add("cm-chip-dragging");
  });
  chip.addEventListener("dragend", () => {
    rebuildLock = false;
    chip.classList.remove("cm-chip-source");
    getView().dom.classList.remove("cm-chip-dragging");
  });
  chip.addEventListener("dblclick", () => {
    rebuildLock = false;
    const view = getView();
    view.dispatch({ selection: { anchor: Math.floor((from + to) / 2) } });
    view.focus();
  });
}

// ── Token chip widget (wildcard, embedding) ──────────────────────────

type TokenKind = "wildcard" | "embedding";

class TokenChipWidget extends WidgetType {
  displayName: string;
  kind: TokenKind;
  fullRaw: string;
  from: number;
  to: number;
  getView: () => EditorView;

  constructor(
    displayName: string,
    kind: TokenKind,
    fullRaw: string,
    from: number,
    to: number,
    getView: () => EditorView,
  ) {
    super();
    this.displayName = displayName;
    this.kind = kind;
    this.fullRaw = fullRaw;
    this.from = from;
    this.to = to;
    this.getView = getView;
  }

  eq(other: TokenChipWidget): boolean {
    return this.fullRaw === other.fullRaw && this.from === other.from;
  }

  toDOM(): HTMLElement {
    const chip = document.createElement("span");
    chip.className = `cm-token-chip cm-token-chip-${this.kind}`;
    chip.textContent = this.displayName;
    setupDrag(chip, this.from, this.to, this.fullRaw, this.getView);
    return chip;
  }

  ignoreEvent(e: Event): boolean {
    const t = e.type;
    return t === "mousedown" || t.startsWith("drag") || t === "drop";
  }
}

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
    return this.fullRaw === other.fullRaw && this.from === other.from;
  }

  toDOM(): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "cm-lora-chip";
    chip.textContent = this.displayName;

    const weightSpan = document.createElement("span");
    weightSpan.className = "cm-lora-chip-weight";
    weightSpan.textContent = this.weight;
    chip.appendChild(weightSpan);

    setupDrag(chip, this.from, this.to, this.fullRaw, this.getView);

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

  ignoreEvent(e: Event): boolean {
    const t = e.type;
    return t === "mousedown" || t.startsWith("drag") || t === "drop";
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

// ── ViewPlugin: chip rendering for all token types ───────────────────

type ChipMatch = {
  from: number;
  to: number;
  widget: WidgetType;
};

export const loraWidgetPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      this.decorations = this.build();
    }

    update(update: ViewUpdate) {
      // Skip rebuild when a chip mousedown is in progress — the chip DOM
      // must survive for dragstart / dblclick to fire on the same element.
      if (rebuildLock && update.selectionSet && !update.docChanged) {
        return;
      }
      if (
        update.docChanged ||
        update.selectionSet ||
        update.focusChanged ||
        update.startState.facet(embeddingNamesFacet) !==
          update.state.facet(embeddingNamesFacet)
      ) {
        this.view = update.view;
        this.decorations = this.build();
      }
    }

    private build(): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      const text = this.view.state.doc.toString();
      const cursorHead = this.view.state.selection.main.head;
      const chips: ChipMatch[] = [];

      // LoRA / LyCo chips
      for (const match of text.matchAll(new RegExp(TOKEN_PATTERN, "g"))) {
        if (match[1] === undefined) continue;
        const tagType = match[1].toLowerCase();

        if (tagType === "lora" || tagType === "lyco") {
          const from = match.index!;
          const to = from + match[0].length;
          const args = match[2];
          const lastColon = args.lastIndexOf(":");
          const name = lastColon > 0 ? args.slice(0, lastColon) : args;
          const weight = lastColon > 0 ? args.slice(lastColon + 1) : "1";
          const displayName = name.split("/").pop() || name;
          chips.push({
            from,
            to,
            widget: new LoraChipWidget(
              displayName,
              weight,
              match[0],
              from,
              to,
              () => this.view,
            ),
          });
        }
      }

      // Wildcard chips: __name__
      for (const match of text.matchAll(new RegExp(TOKEN_PATTERN, "g"))) {
        if (match[3] === undefined) continue;
        const from = match.index!;
        const to = from + match[0].length;
        chips.push({
          from,
          to,
          widget: new TokenChipWidget(
            match[3],
            "wildcard",
            match[0],
            from,
            to,
            () => this.view,
          ),
        });
      }

      // Embedding chips: matched by name from facet
      const embeddings = this.view.state.facet(embeddingNamesFacet);
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
          const from = m.index!;
          const to = from + m[0].length;
          const displayName = m[0].split("/").pop() || m[0];
          chips.push({
            from,
            to,
            widget: new TokenChipWidget(
              displayName,
              "embedding",
              m[0],
              from,
              to,
              () => this.view,
            ),
          });
        }
      }

      // Sort by position and add to builder, skipping cursor-adjacent chips
      // only when editor is focused (unfocused = no editing, show all chips)
      const excludeAtCursor = this.view.hasFocus;
      chips.sort((a, b) => a.from - b.from);
      for (const c of chips) {
        if (excludeAtCursor && cursorHead > c.from && cursorHead < c.to) continue;
        builder.add(c.from, c.to, Decoration.replace({ widget: c.widget }));
      }

      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

// ── Drag-and-drop handler for chip reordering ────────────────────────

export const loraDragDrop = EditorView.domEventHandlers({
  dragover(e, view) {
    if (!e.dataTransfer?.types.includes(DRAG_MIME)) return false;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos !== null) {
      view.dispatch({ selection: { anchor: pos } });
    }
    return true;
  },
  drop(e, view) {
    if (!e.dataTransfer?.types.includes(DRAG_MIME)) return false;
    e.preventDefault();

    const data = JSON.parse(e.dataTransfer.getData(DRAG_MIME));
    const { from, to, raw } = data as { from: number; to: number; raw: string };

    // Verify source text hasn't changed since drag started
    if (view.state.sliceDoc(from, to) !== raw) return true;

    const dropPos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (dropPos === null) return true;

    // Extend deletion range to consume one adjacent space
    let delFrom = from;
    let delTo = to;
    const doc = view.state.doc.toString();
    if (delTo < doc.length && doc[delTo] === " ") delTo++;
    else if (delFrom > 0 && doc[delFrom - 1] === " ") delFrom--;

    // Dropping inside the (whitespace-extended) source range is a no-op
    if (dropPos >= delFrom && dropPos <= delTo) return true;

    const insertText = dropPos === 0 ? `${raw} ` : ` ${raw}`;

    // Changes must be sorted by position for CM
    const changes = dropPos <= delFrom
      ? [{ from: dropPos, insert: insertText }, { from: delFrom, to: delTo }]
      : [{ from: delFrom, to: delTo }, { from: dropPos, insert: insertText }];

    view.dispatch({ changes });

    return true;
  },
});
