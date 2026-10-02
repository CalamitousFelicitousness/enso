import { useModelCapabilities } from "@/hooks/useModelCapabilities";

/** Whether the loaded model's pipeline takes a strength parameter. Unknown
 * (the selected model is not loaded) counts as supported. */
export function useStrengthSupported(): boolean {
  return useModelCapabilities().strengthSupported;
}
