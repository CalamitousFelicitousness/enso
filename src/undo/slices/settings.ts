// The Images settings: every key of defaultParams. The LUT's name and hash
// travel together.

import { defaultParams, useGenerationStore, type GenerationState } from "@/stores/generationStore";
import { keySlice } from "../slice";

export const settingsSlice = () =>
  keySlice({
    name: "settings",
    scope: "images",
    store: useGenerationStore,
    keys: Object.keys(defaultParams),
    groups: [["gradingLutFile", "gradingLutHash"]],
    set: (values) => useGenerationStore.getState().setParams(values as Partial<GenerationState>),
  });
