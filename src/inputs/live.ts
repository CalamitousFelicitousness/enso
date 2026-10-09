// What this page holds the bytes of in memory, which a reclaim must not free:
// the inputs, what the pending Undo would put back, and the maps in the cache.

import { useInputStore } from "@/stores/inputStore";
import { cidsOf } from "@/lib/inputs/types";
import { useMapStore } from "./maps";
import { undoHolds } from "./undo";

export function liveCids(): ReadonlySet<string> {
  const live = new Set(cidsOf(useInputStore.getState().frames));
  for (const cid of undoHolds()) live.add(cid);
  for (const map of useMapStore.getState().current.values()) live.add(map.cid);
  return live;
}
