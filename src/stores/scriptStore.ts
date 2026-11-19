import { create } from "zustand";

interface ScriptState {
  selectedScript: string;
  scriptArgs: unknown[];
  /** Each always-on script's settings by position; null keeps the server's default. */
  alwaysOnOverrides: Record<string, unknown[]>;

  setSelectedScript: (name: string) => void;
  setScriptArg: (index: number, value: unknown) => void;
  setAlwaysOnArg: (name: string, index: number, value: unknown) => void;
}

export const useScriptStore = create<ScriptState>()((set) => ({
  selectedScript: "",
  scriptArgs: [],
  alwaysOnOverrides: {},

  setSelectedScript: (name) => set({ selectedScript: name, scriptArgs: [] }),

  setScriptArg: (index, value) =>
    set((state) => {
      const args = [...state.scriptArgs];
      while (args.length <= index) args.push(null);
      args[index] = value;
      return { scriptArgs: args };
    }),

  setAlwaysOnArg: (name, index, value) =>
    set((state) => {
      const overrides = { ...state.alwaysOnOverrides };
      const args = [...(overrides[name] ?? [])];
      while (args.length <= index) args.push(null);
      args[index] = value;
      overrides[name] = args;
      return { alwaysOnOverrides: overrides };
    }),
}));
