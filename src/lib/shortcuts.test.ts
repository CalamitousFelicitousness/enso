import { describe, expect, it } from "vitest";
import {
  SHORTCUTS,
  formatShortcut,
  matchesEvent,
  type KeyInput,
  type ShortcutDef,
} from "./shortcuts";

function press(key: string, init: Partial<KeyInput> = {}): KeyInput {
  return { key, code: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...init };
}

/** The def a key press reaches first in a scope, as the dispatcher walks them. */
function first(scope: ShortcutDef["scope"], e: KeyInput): string | undefined {
  return Object.values(SHORTCUTS).find((d) => d.scope === scope && matchesEvent(d, e))?.id;
}

describe("matchesEvent", () => {
  it("opens the cheat sheet with ? whether the layout shifts it or not", () => {
    const def = SHORTCUTS["cheatsheet"];
    expect(matchesEvent(def, press("?", { shiftKey: true, code: "Slash" }))).toBe(true);
    expect(matchesEvent(def, press("?", { code: "Minus" }))).toBe(true);
    expect(matchesEvent(def, press("?", { shiftKey: true, ctrlKey: true }))).toBe(false);
  });

  it("zooms in with + typed any way: Shift+= on US, unshifted elsewhere, the numpad", () => {
    expect(first("canvas", press("+", { shiftKey: true, code: "Equal" }))).toBe("canvas-zoom-in");
    expect(first("canvas", press("+", { code: "BracketRight" }))).toBe("canvas-zoom-in");
    expect(first("canvas", press("+", { code: "NumpadAdd" }))).toBe("canvas-zoom-in");
    expect(first("canvas", press("=", { code: "Equal" }))).toBe("canvas-zoom-in-eq");
    expect(first("canvas", press("-", { code: "NumpadSubtract" }))).toBe("canvas-zoom-out");
  });

  it("matches the Shift+digit keys by the physical key on every layout", () => {
    // US: Shift+1 types "!"; German: Shift+0 types "="; French: Shift+& types "1"
    expect(first("canvas", press("!", { shiftKey: true, code: "Digit1" }))).toBe("canvas-show-all");
    expect(first("canvas", press("=", { shiftKey: true, code: "Digit0" }))).toBe("canvas-zoom-100");
    expect(first("canvas", press("1", { shiftKey: true, code: "Digit1" }))).toBe("canvas-show-all");
    expect(first("canvas", press('"', { shiftKey: true, code: "Digit2" }))).toBe(
      "canvas-zoom-frame",
    );
    expect(first("canvas", press("1", { code: "Digit1" }))).toBeUndefined();
  });

  it("keeps the arrows for frames and Shift+arrows for panning", () => {
    expect(first("canvas", press("ArrowLeft"))).toBe("canvas-focus-prev");
    expect(first("canvas", press("ArrowLeft", { shiftKey: true }))).toBe("canvas-pan-left");
    expect(first("canvas", press("ArrowDown", { shiftKey: true }))).toBe("canvas-pan-down");
    expect(first("canvas", press("ArrowDown"))).toBeUndefined();
  });

  it("leaves letters and modified keys as they were", () => {
    expect(matchesEvent(SHORTCUTS["canvas-brush"], press("b"))).toBe(true);
    expect(matchesEvent(SHORTCUTS["canvas-brush"], press("B", { shiftKey: true }))).toBe(false);
    expect(matchesEvent(SHORTCUTS["command-palette"], press("k", { ctrlKey: true }))).toBe(true);
    expect(first("global", press("\\", { ctrlKey: true }))).toBe("toggle-left-panel");
    expect(first("global", press("|", { ctrlKey: true, shiftKey: true }))).toBeUndefined();
    expect(first("global", press("\\", { ctrlKey: true, shiftKey: true }))).toBe(
      "toggle-right-panel",
    );
  });
});

describe("formatShortcut", () => {
  it("shows a physical-key def by the character it names", () => {
    expect(formatShortcut(SHORTCUTS["canvas-show-all"])).toMatch(/^(Shift|⇧)\+1$/);
    expect(formatShortcut(SHORTCUTS["canvas-zoom-in"])).toBe("+");
  });
});
