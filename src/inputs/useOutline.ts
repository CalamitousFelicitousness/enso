import { replaceEqualDeep } from "@tanstack/react-query";
import { computeOutline, type Outline } from "@/lib/inputs/outline";
import type { Frame } from "@/lib/inputs/types";
import { useInputStore } from "@/stores/inputStore";
import { useModelCapabilities } from "@/hooks/useModelCapabilities";

let last: { frames: Frame[]; controlUnified: boolean; outline: Outline } | null = null;

/** The outline of a frame list. Parts that did not change keep their
 * identity from one list to the next, so a mask stroke or a layer move hands
 * every consumer the outline it already has. `controlUnified`: the model
 * carries its control model, so a ControlNet frame needs none. */
export function outlineOf(frames: Frame[], controlUnified = false): Outline {
  if (last?.frames === frames && last.controlUnified === controlUnified) return last.outline;
  const next = computeOutline(frames, { controlUnified });
  const outline = last ? replaceEqualDeep(last.outline, next) : next;
  last = { frames, controlUnified, outline };
  return outline;
}

export function useOutline(): Outline {
  const { controlUnified } = useModelCapabilities();
  return useInputStore((s) => outlineOf(s.frames, controlUnified === true));
}
