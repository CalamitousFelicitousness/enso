import { replaceEqualDeep } from "@tanstack/react-query";
import { computeOutline, type Outline } from "@/lib/inputs/outline";
import type { Frame } from "@/lib/inputs/types";
import { useInputStore } from "@/stores/inputStore";

let last: { frames: Frame[]; outline: Outline } | null = null;

/** The outline of a frame list. Parts that did not change keep their
 * identity from one list to the next, so a mask stroke or a layer move hands
 * every consumer the outline it already has. */
export function outlineOf(frames: Frame[]): Outline {
  if (last?.frames === frames) return last.outline;
  const next = computeOutline(frames);
  const outline = last ? replaceEqualDeep(last.outline, next) : next;
  last = { frames, outline };
  return outline;
}

export function useOutline(): Outline {
  return useInputStore((s) => outlineOf(s.frames));
}
