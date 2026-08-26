import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { SubTabItem } from "@/lib/constants";

export interface TabDescriptor<Id extends string> {
  id: Id;
  label: string;
  icon: LucideIcon;
  /** `${namespace}-${id}`, unique across the document. */
  panelId: string;
  Component: ComponentType;
  selfScroll?: boolean;
}

/**
 * Join a nav registry to its components. `components` is keyed by the full
 * id union, so a tab added to the registry without a component fails tsc
 * rather than rendering an empty panel.
 */
export function createTabRegistry<Id extends string>(opts: {
  namespace: string;
  tabs: readonly (SubTabItem & { id: Id })[];
  components: Record<Id, ComponentType>;
  selfScroll?: readonly Id[];
}): readonly TabDescriptor<Id>[] {
  const selfScroll = new Set<string>(opts.selfScroll ?? []);
  return opts.tabs.map((tab) => ({
    id: tab.id,
    label: tab.label,
    icon: tab.icon,
    panelId: `${opts.namespace}-${tab.id}`,
    Component: opts.components[tab.id],
    ...(selfScroll.has(tab.id) ? { selfScroll: true as const } : {}),
  }));
}

/** Panel entries for buildPanels, in registry order. */
export function tabPanelEntries<Id extends string>(registry: readonly TabDescriptor<Id>[]) {
  return registry.map(({ panelId, Component, selfScroll }) => ({
    id: panelId,
    content: <Component />,
    ...(selfScroll ? { selfScroll } : {}),
  }));
}
