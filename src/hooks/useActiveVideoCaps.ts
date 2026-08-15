import { useMemo } from "react";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { useVideoCaps } from "@/api/hooks/useVideo";
import { isLocalVideoModel } from "@/lib/videoModel";
import { FALLBACK_CAPS, capsKey } from "@/lib/video/caps";
import type { VideoModelCaps } from "@/api/types/video";

/** Caps for the active video model: the live query wins, the snapshot
 * carried on activeModel bridges until it resolves, and the permissive
 * fallback covers cloud, synthetic, and unknown models. */
export function useActiveVideoCaps(): VideoModelCaps {
  const activeModel = useModelSelectionStore((s) => s.activeModel);
  const capsMap = useVideoCaps();
  return useMemo(() => {
    if (!isLocalVideoModel(activeModel)) return FALLBACK_CAPS;
    return (
      capsMap.get(capsKey(activeModel.engine, activeModel.model)) ??
      activeModel.caps ??
      FALLBACK_CAPS
    );
  }, [activeModel, capsMap]);
}
