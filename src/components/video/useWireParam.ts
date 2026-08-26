import { useCallback } from "react";
import { useVideoStore } from "@/stores/videoStore";
import { WIRE_TO_STORE, type VideoJobType, type VideoParamKey } from "@/lib/video/paramRegistry";

// Bind a form control to the store param that carries a given WIRE name for
// the active job type; the registry translates (e.g. "steps" -> ltxSteps for
// ltx jobs). `key` is undefined when the job's wire has no such param, which
// is the render gate for the control.
export function useWireParam<T extends number | string | boolean>(
  job: VideoJobType,
  wire: string,
): { key: VideoParamKey | undefined; value: T | undefined; set: (v: T) => void } {
  const key = WIRE_TO_STORE[job][wire];
  const value = useVideoStore((s) => (key !== undefined ? s[key] : undefined)) as T | undefined;
  const set = useCallback(
    (v: T) => {
      if (key !== undefined) useVideoStore.getState().setParam(key, v);
    },
    [key],
  );
  return { key, value, set };
}
