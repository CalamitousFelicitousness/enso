import { useModelCapabilities } from "@/hooks/useModelCapabilities";
import { useFrameShapes } from "@/canvas/useFrameShapes";
import { enumerateWireSlots } from "@/canvas/inputFrames";

export const INPUTS_FULL_HINT = "This model takes no more input images";

/** The input frames already hold as many images as the active model takes. */
export function useInputsAtCapacity(): boolean {
  const { maxInputImages } = useModelCapabilities();
  const frames = useFrameShapes();
  return maxInputImages != null && enumerateWireSlots(frames).length >= maxInputImages;
}
