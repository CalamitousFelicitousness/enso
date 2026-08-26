import { useMemo } from "react";
import type { TabDescriptor } from "./tabRegistry";

/**
 * Resolve which tabs the rail shows and which panel is active.
 *
 * The stored selection is clamped for display but never written back, so
 * switching to a model that hides the current tab and back again returns the
 * user to where they were.
 */
export function useSubTabs<Id extends string>(opts: {
  registry: readonly TabDescriptor<Id>[];
  /** Memoized by the caller; recomputes visibility when it changes. */
  isVisible: (id: Id) => boolean;
  stored: Id;
  fallback: Id;
}): { visible: TabDescriptor<Id>[]; active: Id; activePanelId: string } {
  const { registry, isVisible, stored, fallback } = opts;
  return useMemo(() => {
    const visible = registry.filter((tab) => isVisible(tab.id));
    const active = visible.some((tab) => tab.id === stored) ? stored : fallback;
    const activePanelId = registry.find((tab) => tab.id === active)?.panelId ?? `${String(active)}`;
    return { visible, active, activePanelId };
  }, [registry, isVisible, stored, fallback]);
}
