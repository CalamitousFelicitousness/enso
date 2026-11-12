// Saved generation presets.

import { usePresetStore, type GenerationPreset } from "@/stores/presetStore";
import { keySlice } from "../slice";

export const presetsSlice = () =>
  keySlice({
    name: "presets",
    scope: "shared",
    store: usePresetStore,
    keys: ["presets"],
    set: (values) => usePresetStore.setState({ presets: values["presets"] as GenerationPreset[] }),
  });
