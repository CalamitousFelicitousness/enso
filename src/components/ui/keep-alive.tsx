import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

// ── Contexts ───────────────────────────────────────────────────────

const KeepAliveVisibleContext = createContext<boolean>(true);
const KeepAliveSwitchContext = createContext<string | null>(null);

/**
 * Returns whether the nearest KeepAlivePanel ancestor is currently visible.
 *
 * AND-combines through nesting: returns true only if every ancestor
 * KeepAlivePanel is also active. A descendant inside a hidden grandparent
 * panel reads false even when its immediate parent panel is "active" within
 * its own switch.
 *
 * Defaults to true outside any KeepAlive boundary so consumers can call this
 * hook unconditionally.
 *
 * Use it to gate work that should pause while hidden — pass to React Query
 * `enabled`, gate `refetchInterval`, pause animations, or fire imperative
 * work (e.g. `view.requestMeasure()`) on the hidden→visible transition.
 */
export function useKeepAliveVisible(): boolean {
  return useContext(KeepAliveVisibleContext);
}

// ── Atom: KeepAlivePanel ───────────────────────────────────────────

interface KeepAlivePanelProps {
  /**
   * Stable identifier — required when used inside KeepAliveSwitch (the switch
   * uses it to track visited state and resolve which panel is active).
   * Optional when used standalone with an explicit `active` prop.
   */
  id?: string;
  /**
   * Whether this panel is the currently visible one. If omitted, falls back to
   * looking up the parent KeepAliveSwitch's active id and comparing to `id`.
   */
  active?: boolean;
  /** Class applied when active. Defaults to a vertical-flex-friendly fill. */
  activeClassName?: string;
  /** Class applied when hidden. Defaults to Tailwind `hidden` (display:none). */
  hiddenClassName?: string;
  children: ReactNode;
}

/**
 * Wraps a single panel that should remain mounted but toggle visibility.
 *
 * Hidden panels stay in the DOM with display:none and `inert`, so children
 * retain state (CodeMirror cursor, scroll, drafts, undo) while being removed
 * from layout, focus order, and the accessibility tree.
 *
 * Visibility AND-combines with any ancestor KeepAlivePanel — see
 * useKeepAliveVisible.
 */
export function KeepAlivePanel({
  id,
  active: explicitActive,
  activeClassName = "flex-1 min-h-0",
  hiddenClassName = "hidden",
  children,
}: KeepAlivePanelProps) {
  const parentVisible = useKeepAliveVisible();
  const switchActiveId = useContext(KeepAliveSwitchContext);
  const localActive =
    explicitActive ?? (id != null && switchActiveId === id);
  const visible = parentVisible && localActive;
  return (
    <KeepAliveVisibleContext.Provider value={visible}>
      <div
        data-slot="keep-alive-panel"
        data-panel-id={id}
        data-active={visible ? "" : undefined}
        inert={!visible}
        className={cn(visible ? activeClassName : hiddenClassName)}
      >
        {children}
      </div>
    </KeepAliveVisibleContext.Provider>
  );
}

// ── Composer: KeepAliveSwitch ──────────────────────────────────────

interface KeepAliveSwitchProps {
  /** Id of the currently visible panel. */
  active: string;
  /**
   * Optional ids to mount on first render in addition to `active`.
   * Use sparingly — only when a specific panel benefits from being warmed
   * up before its first visit.
   */
  initiallyMounted?: readonly string[];
  /**
   * KeepAlivePanel siblings, each with a stable `id`. Other children are
   * ignored.
   */
  children: ReactNode;
}

/**
 * Renders one of N KeepAlivePanel siblings, keeping previously-visited panels
 * mounted so subsequent switches are instant and per-panel state is preserved.
 *
 * Lazy first mount: a panel mounts on its first visit and stays in the tree
 * for the lifetime of the switch.
 *
 * Unknown `active` ids are tolerated — no panel is shown and the visited set
 * is unchanged, so a transient bad id (e.g. during gating fallback) doesn't
 * pollute state.
 */
export function KeepAliveSwitch({
  active,
  initiallyMounted,
  children,
}: KeepAliveSwitchProps) {
  const panels = useMemo(
    () => Children.toArray(children).filter(isPanelElement),
    [children],
  );

  const knownIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of panels) {
      const id = p.props.id;
      if (typeof id === "string") ids.add(id);
    }
    return ids;
  }, [panels]);

  const [visited, setVisited] = useState<ReadonlySet<string>>(() => {
    const initial = new Set<string>();
    if (knownIds.has(active)) initial.add(active);
    if (initiallyMounted) {
      for (const id of initiallyMounted) {
        if (knownIds.has(id)) initial.add(id);
      }
    }
    return initial;
  });

  // Update-during-render to record first visit. React discards the in-flight
  // render and re-renders before commit, so the user never sees a blank frame.
  // Functional updater + has() guard makes this StrictMode- and concurrent-safe.
  if (knownIds.has(active) && !visited.has(active)) {
    setVisited((prev) => {
      if (prev.has(active)) return prev;
      const next = new Set(prev);
      next.add(active);
      return next;
    });
  }

  return (
    <KeepAliveSwitchContext.Provider value={active}>
      {panels.map((panel) => {
        const id = panel.props.id;
        if (typeof id !== "string" || !visited.has(id)) return null;
        return panel;
      })}
    </KeepAliveSwitchContext.Provider>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

type PanelElement = ReactElement<KeepAlivePanelProps>;

function isPanelElement(node: ReactNode): node is PanelElement {
  return isValidElement(node) && node.type === KeepAlivePanel;
}
