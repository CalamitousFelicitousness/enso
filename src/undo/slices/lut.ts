// The Images LUT file picked in this browser. Its bytes count toward the
// history's budget under an id of their own.

import type { PendingLut } from "@/lib/lut";
import type { Patch } from "@/lib/undo/types";
import { useLutStore } from "@/stores/lutStore";
import { keySlice } from "../slice";

const ids = new WeakMap<Blob, string>();
let counter = 0;

function idOf(file: Blob): string {
  let id = ids.get(file);
  if (!id) {
    id = `lut:${++counter}`;
    ids.set(file, id);
  }
  return id;
}

function named(value: unknown): [string, number][] {
  const pending = value as PendingLut | null | undefined;
  return pending ? [[idOf(pending.file), pending.file.size]] : [];
}

export const lutSlice = () => ({
  ...keySlice({
    name: "lut",
    scope: "images",
    store: useLutStore,
    keys: ["images"],
    set: (values) =>
      useLutStore.getState().setPending("images", values["images"] as PendingLut | null),
  }),
  cids: (patch: Patch) =>
    patch.kind === "keys"
      ? [...named(patch.before["images"]), ...named(patch.after["images"])]
      : [],
  named: () => named(useLutStore.getState().images).map(([id]) => id),
});
