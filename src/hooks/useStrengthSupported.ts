import { useServerInfo } from "@/api/hooks/useServer";

/** Whether the loaded model's pipeline takes a strength parameter. Unknown
 * (no server info yet) counts as supported. */
export function useStrengthSupported(): boolean {
  return useServerInfo().data?.model?.supports_strength ?? true;
}
