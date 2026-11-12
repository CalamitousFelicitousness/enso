// Fit: whether the generation frame takes an input picture's size.

import { useUiStore } from "@/stores/uiStore";
import { keySlice } from "../slice";

export const fitSlice = () =>
  keySlice({
    name: "fit",
    scope: "images",
    store: useUiStore,
    keys: ["autoFitFrame"],
    set: (values) => useUiStore.getState().setAutoFitFrame(values["autoFitFrame"] as boolean),
  });
