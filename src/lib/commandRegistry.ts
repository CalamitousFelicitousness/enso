import { useEffect, useRef } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { LucideIcon } from "lucide-react";

/**
 * A command is a discoverable, invocable action surfaced in the Command Palette.
 * Use this for dialog/dropdown actions (PNG Info, Restart, Model Merge…) and
 * imperative actions (Generate, Interrupt, Skip) that the palette should be
 * able to invoke directly rather than just scroll to.
 *
 * Convention: ids are namespaced — "actions:generate", "image:open-png-info",
 * "system:restart", "models:merge". The prefix groups related commands and
 * keeps id collisions trivial to spot.
 */
export interface PaletteCommand {
  id: string;
  label: string;
  group: string;
  keywords?: string[];
  icon?: LucideIcon;
  shortcutId?: string;
  showOnlyInSearch?: boolean;
  run: () => void | Promise<void>;
}

interface CommandRegistryState {
  commands: Map<string, PaletteCommand>;
  register: (cmd: PaletteCommand) => void;
  unregister: (id: string) => void;
}

export const useCommandRegistry = create<CommandRegistryState>((set) => ({
  commands: new Map(),
  register: (cmd) =>
    set((state) => {
      const next = new Map(state.commands);
      next.set(cmd.id, cmd);
      return { commands: next };
    }),
  unregister: (id) =>
    set((state) => {
      if (!state.commands.has(id)) return {};
      const next = new Map(state.commands);
      next.delete(id);
      return { commands: next };
    }),
}));

export function registerCommand(cmd: PaletteCommand): void {
  useCommandRegistry.getState().register(cmd);
}

export function unregisterCommand(id: string): void {
  useCommandRegistry.getState().unregister(id);
}

export function runCommand(id: string): boolean {
  const cmd = useCommandRegistry.getState().commands.get(id);
  if (!cmd) return false;
  void cmd.run();
  return true;
}

export function getAllCommands(): PaletteCommand[] {
  return Array.from(useCommandRegistry.getState().commands.values());
}

/**
 * Subscribe a React component to the live command list. Re-renders when
 * commands are registered or unregistered. Use this in CommandPalette.
 */
export function useCommands(): PaletteCommand[] {
  return useCommandRegistry(
    useShallow((s) => Array.from(s.commands.values())),
  );
}

/**
 * Register a command for the lifetime of the calling component.
 *
 * Display metadata (label, keywords, icon, group) is captured at mount time
 * via the `id` dependency. The `run` handler is always invoked through a ref
 * so it sees the latest closure (current state, current callbacks) without
 * forcing re-registration on every render.
 *
 * If you need the displayed label or keywords to change at runtime, change
 * the `id` to force re-registration.
 */
export function useRegisterCommand(cmd: PaletteCommand): void {
  const cmdRef = useRef(cmd);
  cmdRef.current = cmd;

  useEffect(() => {
    const wrapped: PaletteCommand = {
      id: cmd.id,
      label: cmd.label,
      group: cmd.group,
      keywords: cmd.keywords,
      icon: cmd.icon,
      shortcutId: cmd.shortcutId,
      showOnlyInSearch: cmd.showOnlyInSearch,
      run: () => cmdRef.current.run(),
    };
    registerCommand(wrapped);
    return () => unregisterCommand(cmd.id);
    // Capture display metadata at mount; re-register only when id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd.id]);
}
