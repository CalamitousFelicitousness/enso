// What a fit has to show and what it has to keep clear of: the frames, the
// chrome anchored to them (docks, hats, Add buttons) as measured, and the
// chrome pinned to the container's edges (the controls, the mask toolbar, the minimap).

import type { Box, Insets } from "./types";

/** Chrome pinned to the container, in CSS pixels: `top` and `bottom` sit on
 * that edge, `width` their own width and `height` how far they reach in from
 * it; `corner` sits in the bottom-right, `width` and `height` how far it
 * reaches in from the right and bottom edges. A fit keeps clear of it when
 * `clear` is set. */
export interface ScreenChrome {
  kind: "screen";
  place: "top" | "bottom" | "corner";
  width: number;
  height: number;
  clear: boolean;
}

/** Chrome a fit must keep in view or clear of. World chrome hangs off the
 * frames and is measured in display units; screen chrome is pinned to the
 * container. */
export type ChromeEntry = { kind: "world"; box: Box } | ScreenChrome;

export type ChromeBoxes = ReadonlyMap<string, ChromeEntry>;

/** Something a fit can target: a frame or a video slot, by id. */
export interface FitFrame {
  id: string;
  box: Box;
}

export interface FitTargets {
  /** Every frame and every piece of world chrome; null with nothing to show. */
  all: Box | null;
  /** A frame with its own dock as it is now; null for an unknown id. */
  frame: (id: string) => Box | null;
  /** The container insets to fit inside; a fit keeps the one that scales most. */
  insets: Insets[];
}

/** Space a fit leaves between the content and the container's edges. */
export const FIT_MARGIN = 24;
/** Space a fit leaves between the content and chrome pinned to an edge. */
export const CHROME_GAP = 12;

/** The registry key of a frame's dock or hat. */
export function dockKey(id: string): string {
  return `dock:${id}`;
}

/** The smallest box holding all of them; null for none. */
export function unionBoxes(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function worldBox(chrome: ChromeBoxes, key: string): Box | null {
  const entry = chrome.get(key);
  return entry?.kind === "world" ? entry.box : null;
}

/** The container insets: the margin and room for the top and bottom chrome, and with
 * chrome in the corner two variants, its box taken off the bottom or off the
 * right. */
export function screenInsets(chrome: ChromeBoxes): Insets[] {
  let top = FIT_MARGIN;
  let bottom = FIT_MARGIN;
  let cornerW = 0;
  let cornerH = 0;
  for (const entry of chrome.values()) {
    if (entry.kind !== "screen" || !entry.clear) continue;
    if (entry.place === "top") {
      top = Math.max(top, entry.height + CHROME_GAP);
    } else if (entry.place === "bottom") {
      bottom = Math.max(bottom, entry.height + CHROME_GAP);
    } else {
      cornerW = Math.max(cornerW, entry.width + CHROME_GAP);
      cornerH = Math.max(cornerH, entry.height + CHROME_GAP);
    }
  }
  const base = { top, right: FIT_MARGIN, bottom, left: FIT_MARGIN };
  if (cornerW === 0) return [base];
  return [
    { ...base, bottom: Math.max(bottom, cornerH) },
    { ...base, right: Math.max(FIT_MARGIN, cornerW) },
  ];
}

export function fitTargets(frames: readonly FitFrame[], chrome: ChromeBoxes): FitTargets {
  const world: Box[] = [];
  for (const entry of chrome.values()) if (entry.kind === "world") world.push(entry.box);
  return {
    all: unionBoxes([...frames.map((f) => f.box), ...world]),
    frame: (id) => {
      const frame = frames.find((f) => f.id === id);
      if (!frame) return null;
      const dock = worldBox(chrome, dockKey(id));
      return dock ? unionBoxes([frame.box, dock]) : frame.box;
    },
    insets: screenInsets(chrome),
  };
}
