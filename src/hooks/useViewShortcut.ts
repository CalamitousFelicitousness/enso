import { useUiStore } from "@/stores/uiStore";
import { useShortcut } from "./useShortcut";
import type { NavView } from "@/lib/constants";

/**
 * Register a keyboard shortcut only while `view` is the active nav view.
 *
 * KeepAlive keeps a visited panel mounted after the user leaves it, so an
 * unguarded registration lets whichever view mounted last own the id. The
 * handler re-checks the view to cover the commit where both are registered.
 */
export function useViewShortcut(view: NavView, id: string, handler: (e: KeyboardEvent) => void) {
  const isActive = useUiStore((s) => s.activeNavView === view);
  useShortcut(
    id,
    (e) => {
      if (useUiStore.getState().activeNavView !== view) return;
      handler(e);
    },
    isActive,
  );
}
