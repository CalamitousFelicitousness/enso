import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { useActiveVideoCaps } from "@/hooks/useActiveVideoCaps";
import { resolveVideoUi, type VideoUiKind } from "@/lib/videoModel";
import { jobTypeForKind } from "@/lib/video/buildVideoPayload";
import type { VideoModelCaps } from "@/api/types/video";
import type { VideoJobType } from "@/lib/video/paramRegistry";

/** What every video sub-tab needs: the UI kind, the wire job type (null for
 * cloud and empty), and the active model's capability descriptor. */
export function useVideoTabContext(): {
  kind: VideoUiKind;
  job: VideoJobType | null;
  caps: VideoModelCaps;
} {
  const activeModel = useModelSelectionStore((s) => s.activeModel);
  const caps = useActiveVideoCaps();
  const kind = resolveVideoUi(activeModel);
  const job = kind === "cloud" || kind === "empty" ? null : jobTypeForKind(kind);
  return { kind, job, caps };
}
