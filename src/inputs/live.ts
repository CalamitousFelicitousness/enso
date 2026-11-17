// What this page holds the bytes of in memory, which a reclaim must not free:
// the inputs, what the undo history names, and the maps in the cache.

import { useInputStore } from "@/stores/inputStore";
import { cidsOf } from "@/lib/inputs/types";
import { holds } from "@/undo/marks";
import { useMapStore } from "./maps";

export function liveCids(): ReadonlySet<string> {
  const live = new Set(cidsOf(useInputStore.getState().frames));
  for (const cid of holds()) live.add(cid);
  for (const map of useMapStore.getState().current.values()) live.add(map.cid);
  return live;
}
