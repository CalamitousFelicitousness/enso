// The model pick, shared by every view. Checked: Undo writes it only while
// the step is its last writer.

import type { UnifiedModel } from "@/api/types/cloud";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { keySlice } from "../slice";

/** What names a model the way the Model Selector tells picks apart. */
function identity(model: UnifiedModel): string {
  if (model.source === "local") return `local:${model.title}`;
  if (model.source === "local-video") return `video:${model.engine}:${model.model}`;
  return `cloud:${model.provider}:${model.id}`;
}

/** A re-pick makes a new object: the same model counts as unchanged. */
function sameModel(a: unknown, b: unknown): boolean {
  const left = a as UnifiedModel | null;
  const right = b as UnifiedModel | null;
  if (!left || !right) return left === right;
  return identity(left) === identity(right);
}

export const modelSlice = () =>
  keySlice({
    name: "model",
    scope: "shared",
    store: useModelSelectionStore,
    keys: ["activeModel"],
    checked: ["activeModel"],
    equal: { activeModel: sameModel },
    set: (values) =>
      useModelSelectionStore
        .getState()
        .setActiveModel(values["activeModel"] as UnifiedModel | null),
  });
