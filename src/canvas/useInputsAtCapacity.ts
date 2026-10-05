import { useModelCapabilities } from "@/hooks/useModelCapabilities";
import { useInputStore } from "@/stores/inputStore";
import { outlineOf } from "@/inputs/useOutline";

export const INPUTS_FULL_HINT = "This model takes no more input images";

/** The input frames already send as many images as the active model takes. */
export function useInputsAtCapacity(): boolean {
  const { maxInputImages } = useModelCapabilities();
  const sent = useInputStore((s) => outlineOf(s.frames).sent.length);
  return maxInputImages != null && sent >= maxInputImages;
}
