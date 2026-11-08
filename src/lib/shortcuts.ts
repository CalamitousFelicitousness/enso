export type ShortcutScope =
  "global" | "canvas" | "gallery" | "lightbox" | "comparison" | "tutorial";

export type ShortcutCategory =
  "Global" | "Canvas" | "Gallery" | "Lightbox" | "Comparison" | "Navigation" | "Tutorial";

export interface ShortcutDef {
  id: string;
  /** The character the key produces, as the cheat sheet shows it. */
  key: string;
  /** Matched by the physical key instead: `Digit0` is Shift+0 on every layout. */
  code?: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  scope: ShortcutScope;
  category: ShortcutCategory;
  label: string;
  /** Left to the focused text field, which has its own meaning for the keys. */
  skipEditable?: boolean;
}

export const SHORTCUTS: Record<string, ShortcutDef> = {
  // Global
  "command-palette": {
    id: "command-palette",
    key: "k",
    ctrl: true,
    scope: "global",
    category: "Global",
    label: "Command palette",
  },
  cheatsheet: {
    id: "cheatsheet",
    key: "?",
    scope: "global",
    category: "Global",
    label: "Keyboard shortcuts",
  },
  generate: {
    id: "generate",
    key: "Enter",
    ctrl: true,
    scope: "global",
    category: "Global",
    label: "Generate",
  },
  skip: {
    id: "skip",
    key: "Enter",
    ctrl: true,
    shift: true,
    scope: "global",
    category: "Global",
    label: "Skip current step",
  },
  undo: {
    id: "undo",
    key: "z",
    ctrl: true,
    scope: "global",
    category: "Global",
    label: "Undo the last change",
    skipEditable: true,
  },
  "toggle-left-rail": {
    id: "toggle-left-rail",
    key: "b",
    ctrl: true,
    scope: "global",
    category: "Global",
    label: "Toggle Left Rail",
  },
  "toggle-left-panel": {
    id: "toggle-left-panel",
    key: "\\",
    ctrl: true,
    scope: "global",
    category: "Global",
    label: "Toggle left panel",
  },
  "toggle-right-panel": {
    id: "toggle-right-panel",
    key: "\\",
    ctrl: true,
    shift: true,
    scope: "global",
    category: "Global",
    label: "Toggle right panel",
  },

  // Canvas
  "canvas-move": {
    id: "canvas-move",
    key: "v",
    scope: "canvas",
    category: "Canvas",
    label: "Move tool",
  },
  "canvas-brush": {
    id: "canvas-brush",
    key: "b",
    scope: "canvas",
    category: "Canvas",
    label: "Brush tool",
  },
  "canvas-eraser": {
    id: "canvas-eraser",
    key: "e",
    scope: "canvas",
    category: "Canvas",
    label: "Eraser tool",
  },
  "canvas-deselect": {
    id: "canvas-deselect",
    key: "Escape",
    scope: "canvas",
    category: "Canvas",
    label: "Deselect / move",
  },
  "canvas-brush-smaller": {
    id: "canvas-brush-smaller",
    key: "[",
    scope: "canvas",
    category: "Canvas",
    label: "Smaller brush",
  },
  "canvas-brush-larger": {
    id: "canvas-brush-larger",
    key: "]",
    scope: "canvas",
    category: "Canvas",
    label: "Larger brush",
  },
  "canvas-delete": {
    id: "canvas-delete",
    key: "Delete",
    scope: "canvas",
    category: "Canvas",
    label: "Remove layer",
  },
  "canvas-delete-backspace": {
    id: "canvas-delete-backspace",
    key: "Backspace",
    scope: "canvas",
    category: "Canvas",
    label: "Remove layer",
  },
  "canvas-zoom-100": {
    id: "canvas-zoom-100",
    key: "0",
    code: "Digit0",
    shift: true,
    scope: "canvas",
    category: "Canvas",
    label: "Zoom to 100%",
  },
  "canvas-show-all": {
    id: "canvas-show-all",
    key: "1",
    code: "Digit1",
    shift: true,
    scope: "canvas",
    category: "Canvas",
    label: "Show all frames",
  },
  "canvas-zoom-frame": {
    id: "canvas-zoom-frame",
    key: "2",
    code: "Digit2",
    shift: true,
    scope: "canvas",
    category: "Canvas",
    label: "Zoom to the current frame",
  },
  // After the Shift+digit keys: Shift+0 types "=" on a German layout
  "canvas-zoom-in": {
    id: "canvas-zoom-in",
    key: "+",
    scope: "canvas",
    category: "Canvas",
    label: "Zoom in",
  },
  "canvas-zoom-in-eq": {
    id: "canvas-zoom-in-eq",
    key: "=",
    scope: "canvas",
    category: "Canvas",
    label: "Zoom in",
  },
  "canvas-zoom-out": {
    id: "canvas-zoom-out",
    key: "-",
    scope: "canvas",
    category: "Canvas",
    label: "Zoom out",
  },
  "canvas-pan-left": {
    id: "canvas-pan-left",
    key: "ArrowLeft",
    shift: true,
    scope: "canvas",
    category: "Canvas",
    label: "Pan the view",
  },
  "canvas-pan-right": {
    id: "canvas-pan-right",
    key: "ArrowRight",
    shift: true,
    scope: "canvas",
    category: "Canvas",
    label: "Pan the view",
  },
  "canvas-pan-up": {
    id: "canvas-pan-up",
    key: "ArrowUp",
    shift: true,
    scope: "canvas",
    category: "Canvas",
    label: "Pan the view",
  },
  "canvas-pan-down": {
    id: "canvas-pan-down",
    key: "ArrowDown",
    shift: true,
    scope: "canvas",
    category: "Canvas",
    label: "Pan the view",
  },
  "canvas-toggle-mode": {
    id: "canvas-toggle-mode",
    key: "f",
    scope: "canvas",
    category: "Canvas",
    label: "Toggle Focus / Canvas mode",
  },
  "canvas-focus-prev": {
    id: "canvas-focus-prev",
    key: "ArrowLeft",
    scope: "canvas",
    category: "Canvas",
    label: "Previous frame",
  },
  "canvas-focus-next": {
    id: "canvas-focus-next",
    key: "ArrowRight",
    scope: "canvas",
    category: "Canvas",
    label: "Next frame",
  },

  // Gallery
  "gallery-toggle-info": {
    id: "gallery-toggle-info",
    key: "i",
    scope: "gallery",
    category: "Gallery",
    label: "Toggle preview panel",
  },
  "gallery-select-all": {
    id: "gallery-select-all",
    key: "a",
    ctrl: true,
    scope: "gallery",
    category: "Gallery",
    label: "Select all",
  },
  "gallery-deselect": {
    id: "gallery-deselect",
    key: "Escape",
    scope: "gallery",
    category: "Gallery",
    label: "Deselect all",
  },
  "gallery-delete": {
    id: "gallery-delete",
    key: "Delete",
    scope: "gallery",
    category: "Gallery",
    label: "Delete selected",
  },
  "gallery-delete-now": {
    id: "gallery-delete-now",
    key: "Delete",
    shift: true,
    scope: "gallery",
    category: "Gallery",
    label: "Delete selected now",
  },

  // Lightbox
  "lightbox-close": {
    id: "lightbox-close",
    key: "Escape",
    scope: "lightbox",
    category: "Lightbox",
    label: "Close lightbox",
  },
  "lightbox-prev": {
    id: "lightbox-prev",
    key: "ArrowLeft",
    scope: "lightbox",
    category: "Lightbox",
    label: "Previous image",
  },
  "lightbox-next": {
    id: "lightbox-next",
    key: "ArrowRight",
    scope: "lightbox",
    category: "Lightbox",
    label: "Next image",
  },
  "lightbox-zoom-in": {
    id: "lightbox-zoom-in",
    key: "+",
    scope: "lightbox",
    category: "Lightbox",
    label: "Zoom in",
  },
  "lightbox-zoom-in-eq": {
    id: "lightbox-zoom-in-eq",
    key: "=",
    scope: "lightbox",
    category: "Lightbox",
    label: "Zoom in",
  },
  "lightbox-zoom-out": {
    id: "lightbox-zoom-out",
    key: "-",
    scope: "lightbox",
    category: "Lightbox",
    label: "Zoom out",
  },
  "lightbox-zoom-reset": {
    id: "lightbox-zoom-reset",
    key: "0",
    scope: "lightbox",
    category: "Lightbox",
    label: "Reset zoom",
  },

  // Comparison
  "comparison-close": {
    id: "comparison-close",
    key: "Escape",
    scope: "comparison",
    category: "Comparison",
    label: "Close comparison",
  },
  "comparison-side-by-side": {
    id: "comparison-side-by-side",
    key: "1",
    scope: "comparison",
    category: "Comparison",
    label: "Side-by-side mode",
  },
  "comparison-swipe": {
    id: "comparison-swipe",
    key: "2",
    scope: "comparison",
    category: "Comparison",
    label: "Swipe mode",
  },
  "comparison-overlay": {
    id: "comparison-overlay",
    key: "3",
    scope: "comparison",
    category: "Comparison",
    label: "Overlay mode",
  },
  "comparison-diff": {
    id: "comparison-diff",
    key: "4",
    scope: "comparison",
    category: "Comparison",
    label: "Diff mode",
  },
  "comparison-toggle": {
    id: "comparison-toggle",
    key: " ",
    scope: "comparison",
    category: "Comparison",
    label: "Toggle A/B (overlay)",
  },
  "comparison-swap": {
    id: "comparison-swap",
    key: "s",
    scope: "comparison",
    category: "Comparison",
    label: "Swap images",
  },
  "comparison-zoom-in": {
    id: "comparison-zoom-in",
    key: "=",
    scope: "comparison",
    category: "Comparison",
    label: "Zoom in",
  },
  "comparison-zoom-out": {
    id: "comparison-zoom-out",
    key: "-",
    scope: "comparison",
    category: "Comparison",
    label: "Zoom out",
  },
  "comparison-zoom-reset": {
    id: "comparison-zoom-reset",
    key: "0",
    scope: "comparison",
    category: "Comparison",
    label: "Reset zoom",
  },

  // Tutorial
  "tutorial-close": {
    id: "tutorial-close",
    key: "Escape",
    scope: "tutorial",
    category: "Tutorial",
    label: "Close tutorial",
  },
};

export type KeyInput = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
>;

/** A lone symbol with no modifier: on some layouts it needs Shift, on others not. */
function isBareSymbol(def: ShortcutDef): boolean {
  return (
    def.key.length === 1 &&
    def.key.toLowerCase() === def.key.toUpperCase() &&
    def.code === undefined &&
    !def.ctrl &&
    !def.shift &&
    !def.alt &&
    !def.meta
  );
}

export function matchesEvent(def: ShortcutDef, e: KeyInput): boolean {
  const ctrl = def.ctrl ?? false;
  const shift = def.shift ?? false;
  const alt = def.alt ?? false;
  const meta = def.meta ?? false;

  if (e.ctrlKey !== ctrl || e.altKey !== alt || e.metaKey !== meta) return false;
  // `?` and `+` are matched by what they type, Shift or not
  if (isBareSymbol(def)) return e.key === def.key;
  if (e.shiftKey !== shift) return false;
  if (def.code !== undefined) return e.code === def.code;

  if (e.key === def.key) return true;
  // Case-insensitive letter match (e.key is "B" when shift is held, but we compare lowercase for unmodified keys)
  if (
    def.key.length === 1 &&
    e.key.toLowerCase() === def.key.toLowerCase() &&
    !ctrl &&
    !alt &&
    !meta
  )
    return true;

  return false;
}

const MOD_SYMBOL = navigator.platform.includes("Mac") ? "\u2318" : "Ctrl";
const SHIFT_SYMBOL = navigator.platform.includes("Mac") ? "\u21e7" : "Shift";
const ALT_SYMBOL = navigator.platform.includes("Mac") ? "\u2325" : "Alt";

const KEY_LABELS: Record<string, string> = {
  Enter: "\u23ce",
  Escape: "Esc",
  ArrowLeft: "\u2190",
  ArrowRight: "\u2192",
  ArrowUp: "\u2191",
  ArrowDown: "\u2193",
  Backspace: "\u232b",
  Delete: "Del",
  " ": "Space",
  "\\": "\\",
};

export function formatShortcut(def: ShortcutDef): string {
  const parts: string[] = [];
  if (def.ctrl) parts.push(MOD_SYMBOL);
  if (def.shift) parts.push(SHIFT_SYMBOL);
  if (def.alt) parts.push(ALT_SYMBOL);
  if (def.meta && !navigator.platform.includes("Mac")) parts.push("Meta");
  parts.push(KEY_LABELS[def.key] ?? def.key.toUpperCase());
  return parts.join("+");
}
