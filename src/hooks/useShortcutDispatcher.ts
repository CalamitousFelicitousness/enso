import { useEffect } from "react";
import { useShortcutStore } from "@/stores/shortcutStore";
import { SHORTCUTS, matchesEvent, type ShortcutScope } from "@/lib/shortcuts";

const SKIP_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** Scopes whose single-key shortcuts fire only with focus on the body or on
 * this element: a focused control elsewhere, such as a switch in the Left
 * Panel, keeps its keys to itself. */
const SURFACES: Partial<Record<ShortcutScope, string>> = {
  canvas: '[data-key-surface="canvas"]',
};

/**
 * Single global keydown listener that dispatches to registered shortcut handlers.
 * Respects scope priority: topmost scope on the stack shadows lower scopes.
 * Skips events a control already handled and events from form inputs.
 * Mount this once in AppShell.
 */
export function useShortcutDispatcher() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const tag = target?.tagName ?? "";
      // Allow modifier-key shortcuts (Ctrl+K, Ctrl+Enter) even inside inputs
      const hasModifier = e.ctrlKey || e.metaKey || e.altKey;
      const isEditable = SKIP_TAGS.has(tag) || target?.isContentEditable === true;
      if (!hasModifier && isEditable) return;
      const onBody =
        target === null || target === document.body || target === document.documentElement;

      const { scopeStack, handlers } = useShortcutStore.getState();
      const activeScope = scopeStack[scopeStack.length - 1];

      // Try active scope first, then fall back to global
      const scopesToCheck = activeScope === "global" ? ["global"] : [activeScope, "global"];

      for (const scope of scopesToCheck) {
        for (const def of Object.values(SHORTCUTS)) {
          if (def.scope !== scope) continue;
          if (!matchesEvent(def, e)) continue;
          if (def.skipEditable && isEditable) continue;
          const surface = SURFACES[def.scope];
          if (surface && !hasModifier && !onBody && !target?.closest(surface)) continue;
          const handler = handlers.get(def.id);
          if (handler) {
            e.preventDefault();
            handler(e);
            return;
          }
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
