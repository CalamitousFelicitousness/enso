import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useUiStore } from "@/stores/uiStore";

// Where a component sits: the ids of the enclosing keep-alive panels, then the titles of the enclosing sections
const UiPathContext = createContext("");

export function useUiPath(): string {
  return useContext(UiPathContext);
}

export function UiPathSegment({ segment, children }: { segment: string; children: ReactNode }) {
  const parent = useUiPath();
  return (
    <UiPathContext.Provider value={parent ? `${parent}/${segment}` : segment}>
      {children}
    </UiPathContext.Provider>
  );
}

/** A collapse remembered across reloads, keyed by the component's place in the UI. */
export function useRememberedCollapse(
  name: string,
  defaultCollapsed: boolean,
): [boolean, (collapsed: boolean) => void] {
  const path = useUiPath();
  const key = path ? `${path}/${name}` : name;
  const stored = useUiStore((s) => s.sectionCollapsed[key]);
  const store = useUiStore((s) => s.setSectionCollapsed);
  const setCollapsed = useCallback((collapsed: boolean) => store(key, collapsed), [store, key]);
  return [stored ?? defaultCollapsed, setCollapsed];
}
