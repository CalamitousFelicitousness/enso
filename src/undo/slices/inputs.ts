// The Images inputs: frames by id and the size source pick, with the
// selection as context. Pictures and mask regions count toward the budget by
// cid.

import type { SizeSourcePick } from "@/lib/inputs/outline";
import { cidsOf, type Frame, type Picture } from "@/lib/inputs/types";
import type { Selection } from "@/lib/inputs/reducers";
import type { Patch } from "@/lib/undo/types";
import { useInputStore } from "@/stores/inputStore";
import { listSlice } from "../slice";

const picture = (p: Picture): [string, number] => [p.cid, p.file?.size ?? 0];

function blobsOf(value: unknown): [string, number][] {
  const frame = value as Frame | null;
  if (!frame) return [];
  return [
    ...frame.pictures.map(picture),
    ...frame.mask.objects.map((m): [string, number] => [m.cid, m.blob.size]),
    ...frame.ipAdapter.masks.map(picture),
  ];
}

export const inputsSlice = () =>
  listSlice({
    name: "inputs",
    scope: "images",
    store: useInputStore,
    items: (s) => s.frames,
    idOf: (frame) => frame.id,
    keys: ["sizeSource"],
    context: (s): Selection => ({ selectedFrameId: s.selectedFrameId, activeItem: s.activeItem }),
    set: (next, context) =>
      useInputStore
        .getState()
        .applyUndo(
          { frames: [...next.items], sizeSource: next.keys["sizeSource"] as SizeSourcePick | null },
          (context as Selection | undefined) ?? null,
        ),
    cids: (patch: Patch) =>
      patch.kind === "list"
        ? Object.values(patch.items).flatMap((c) => [...blobsOf(c.before), ...blobsOf(c.after)])
        : [],
    named: () => cidsOf(useInputStore.getState().frames),
  });
