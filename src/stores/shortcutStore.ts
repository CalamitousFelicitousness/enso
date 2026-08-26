import { create } from "zustand";
import type { ShortcutScope } from "@/lib/shortcuts";

type ShortcutHandler = (e: KeyboardEvent) => void;

interface ShortcutStoreState {
  scopeStack: ShortcutScope[];
  handlers: Map<string, ShortcutHandler>;
  cheatsheetOpen: boolean;

  pushScope: (scope: ShortcutScope) => void;
  popScope: (scope: ShortcutScope) => void;
  register: (id: string, handler: ShortcutHandler) => void;
  unregister: (id: string, handler?: ShortcutHandler) => void;
  setCheatsheetOpen: (open: boolean) => void;
}

export const useShortcutStore = create<ShortcutStoreState>()((set) => ({
  scopeStack: ["global"],
  handlers: new Map(),
  cheatsheetOpen: false,

  pushScope: (scope) =>
    set((s) => {
      if (s.scopeStack[s.scopeStack.length - 1] === scope) return s;
      return { scopeStack: [...s.scopeStack, scope] };
    }),

  popScope: (scope) =>
    set((s) => {
      const idx = s.scopeStack.lastIndexOf(scope);
      if (idx <= 0) return s; // never remove "global"
      const next = [...s.scopeStack];
      next.splice(idx, 1);
      return { scopeStack: next };
    }),

  register: (id, handler) =>
    set((s) => {
      const next = new Map(s.handlers);
      next.set(id, handler);
      return { handlers: next };
    }),

  // Identity-checked: two views can hold the same id across a switch, and the
  // outgoing component's cleanup must not delete the incoming registration.
  unregister: (id, handler) =>
    set((s) => {
      const current = s.handlers.get(id);
      if (current === undefined) return s;
      if (handler !== undefined && current !== handler) return s;
      const next = new Map(s.handlers);
      next.delete(id);
      return { handlers: next };
    }),

  setCheatsheetOpen: (open) => set({ cheatsheetOpen: open }),
}));
