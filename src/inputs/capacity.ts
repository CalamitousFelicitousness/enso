// The model's input image limit, kept in the input store so every path that
// adds an image is refused the same way, and told once.

import { useEffect } from "react";
import { toast } from "sonner";
import { useModelCapabilities } from "@/hooks/useModelCapabilities";
import { onCapacityRefused, useInputStore } from "@/stores/inputStore";

export const INPUTS_FULL_HINT = "This model takes no more input images";

/** Keep the store's image limit at what the active model takes, and tell the
 * user when a change was refused for it. Mounted once. */
export function useCapacitySync(): void {
  const { maxInputImages } = useModelCapabilities();
  useEffect(() => {
    useInputStore.getState().setImageLimit(maxInputImages);
  }, [maxInputImages]);
  useEffect(() => onCapacityRefused(() => toast.info(INPUTS_FULL_HINT)), []);
}
