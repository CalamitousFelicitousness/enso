import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { KeepAliveSwitch } from "@/components/ui/keep-alive";

/** Parks the switch on an id no panel owns, hiding all of them without
 * unmounting any. KeepAliveSwitch tolerates unknown ids by design. */
export const NO_TAB = "__none__";

export interface TabbedPanelProps {
  /** From buildPanels, at module scope. Never rebuilt per render. */
  panels: ReactElement[];
  activePanelId: string;
  header?: ReactNode;
  headerClassName?: string;
  footer?: ReactNode;
  /** Shown above the panels; parks the switch so nothing else renders. */
  emptyState?: ReactNode;
}

/**
 * Left-panel chassis: optional header, a kept-alive tab switch, optional
 * footer. The flex column is required - panels default to
 * activeClassName="flex-1 overflow-hidden", which only sizes inside one.
 */
export function TabbedPanel({
  panels,
  activePanelId,
  header,
  headerClassName,
  footer,
  emptyState,
}: TabbedPanelProps) {
  return (
    <div className="flex flex-col h-full min-w-0">
      {header !== undefined && (
        <div className={cn("shrink-0 border-b border-border px-3 py-2", headerClassName)}>
          {header}
        </div>
      )}
      {emptyState !== undefined && (
        <div className="p-6 text-center text-3xs text-muted-foreground">{emptyState}</div>
      )}
      <KeepAliveSwitch active={emptyState !== undefined ? NO_TAB : activePanelId}>
        {panels}
      </KeepAliveSwitch>
      {footer !== undefined && (
        <div className="shrink-0 border-t border-border px-2 py-1.5">{footer}</div>
      )}
    </div>
  );
}
