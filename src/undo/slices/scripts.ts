// The Scripts tab: the selected script and every script's arguments.

import { useScriptStore } from "@/stores/scriptStore";
import { keySlice } from "../slice";

type Scripts = ReturnType<typeof useScriptStore.getState>;

const KEYS = [
  "selectedScript",
  "scriptArgs",
  "alwaysOnOverrides",
  "alwaysOnEnabled",
] as const satisfies readonly (keyof Scripts)[];

export const scriptsSlice = () =>
  keySlice({
    name: "scripts",
    scope: "images",
    store: useScriptStore,
    keys: KEYS,
    set: (values) => useScriptStore.setState(values as Partial<Scripts>),
  });
