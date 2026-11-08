// The chrome a fit has to respect, as each piece measures itself: docks, hats
// and Add buttons in display units, edge-pinned chrome in CSS pixels. Each
// canvas owns one registry; CanvasSurface provides it to everything inside.

import {
  createContext,
  useContext,
  useLayoutEffect,
  useSyncExternalStore,
  type RefObject,
} from "react";
import type { ChromeBoxes, ChromeEntry } from "@/lib/viewport/insets";

export interface ChromeRegistry {
  set: (key: string, entry: ChromeEntry) => void;
  delete: (key: string) => void;
  /** The same map until something changes. */
  snapshot: () => ChromeBoxes;
  subscribe: (listener: () => void) => () => void;
}

function sameEntry(a: ChromeEntry, b: ChromeEntry): boolean {
  if (a.kind === "world" && b.kind === "world") {
    return (
      a.box.x === b.box.x &&
      a.box.y === b.box.y &&
      a.box.width === b.box.width &&
      a.box.height === b.box.height
    );
  }
  if (a.kind === "screen" && b.kind === "screen") {
    return a.edge === b.edge && a.extent === b.extent;
  }
  return false;
}

export function createChromeRegistry(): ChromeRegistry {
  let boxes = new Map<string, ChromeEntry>();
  const listeners = new Set<() => void>();
  const publish = (next: Map<string, ChromeEntry>) => {
    boxes = next;
    listeners.forEach((listener) => listener());
  };
  return {
    set: (key, entry) => {
      const prev = boxes.get(key);
      if (prev && sameEntry(prev, entry)) return;
      publish(new Map(boxes).set(key, entry));
    },
    delete: (key) => {
      if (!boxes.has(key)) return;
      const next = new Map(boxes);
      next.delete(key);
      publish(next);
    },
    snapshot: () => boxes,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const ChromeContext = createContext<ChromeRegistry | null>(null);

export function useChromeBoxes(registry: ChromeRegistry): ChromeBoxes {
  return useSyncExternalStore(registry.subscribe, registry.snapshot);
}

/** Where a piece of world chrome hangs: its top-left (`edge` "top") or its
 * bottom-left ("bottom") at (x, y) in display units, drawn at `scale`
 * display units per CSS pixel of its own box. */
export interface ChromeAnchor {
  x: number;
  y: number;
  edge: "top" | "bottom";
  scale: number;
}

/** Reports the element's box in display units under `key` while it is
 * mounted; no key, no report. */
export function useWorldChrome(
  key: string | undefined,
  ref: RefObject<HTMLElement | null>,
  { x, y, edge, scale }: ChromeAnchor,
): void {
  const registry = useContext(ChromeContext);
  useLayoutEffect(() => {
    if (!registry || !key) return;
    return () => registry.delete(key);
  }, [registry, key]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!registry || !key || !el) return;
    const report = () => {
      // A hidden view lays nothing out; the last box stands
      if (el.offsetWidth === 0 && el.offsetHeight === 0) return;
      const width = el.offsetWidth * scale;
      const height = el.offsetHeight * scale;
      const top = edge === "top" ? y : y - height;
      registry.set(key, { kind: "world", box: { x, y: top, width, height } });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [registry, key, ref, x, y, edge, scale]);
}

/** Reports how far an element pinned to the container's bottom edge reaches
 * in from it, in CSS pixels, while it is mounted. */
export function useScreenChrome(key: string, ref: RefObject<HTMLElement | null>): void {
  const registry = useContext(ChromeContext);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!registry || !el) return;
    const report = () => {
      const parent = el.offsetParent;
      if (!(parent instanceof HTMLElement) || el.offsetHeight === 0) return;
      registry.set(key, {
        kind: "screen",
        edge: "bottom",
        extent: parent.clientHeight - el.offsetTop,
      });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => {
      observer.disconnect();
      registry.delete(key);
    };
  }, [registry, key, ref]);
}
