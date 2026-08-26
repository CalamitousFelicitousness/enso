import { Suspense, type ReactElement, type ReactNode } from "react";
import { KeepAlivePanel } from "@/components/ui/keep-alive";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface TabPanelEntry {
  /** Namespaced by host so a deep link resolves to one element. See navigateToParam. */
  id: string;
  content: ReactNode;
  /** Panel scrolls itself, so skip the wrapper ScrollArea. */
  selfScroll?: boolean;
}

export interface BuildPanelsOptions {
  activeClassName?: string;
  hiddenClassName?: string;
  /** Wrap panels in a ScrollArea. Off for hosts that size their own content. */
  scroll?: boolean;
  /** Padding div inside the ScrollArea; empty string for none. */
  innerClassName?: string;
}

const FALLBACK = <div className="p-3 text-2xs text-muted-foreground">Loading...</div>;

/**
 * Build the KeepAlivePanel elements for a KeepAliveSwitch.
 *
 * Call this at module scope. The element references have to stay stable
 * across renders: rebuilding them makes the reconciler walk every kept-alive
 * subtree on every parent render, which is the cost KeepAlive exists to avoid.
 */
export function buildPanels(
  entries: readonly TabPanelEntry[],
  options: BuildPanelsOptions = {},
): ReactElement[] {
  const {
    activeClassName = "flex-1 overflow-hidden",
    hiddenClassName,
    scroll = true,
    innerClassName = "p-3 min-w-0",
  } = options;

  return entries.map(({ id, content, selfScroll }) => {
    // Suspense is harmless for eager components and required for lazy ones.
    const inner = <Suspense fallback={FALLBACK}>{content}</Suspense>;
    const body =
      scroll && !selfScroll ? (
        <ScrollArea className="size-full">
          {innerClassName ? <div className={innerClassName}>{inner}</div> : inner}
        </ScrollArea>
      ) : (
        inner
      );
    return (
      <KeepAlivePanel
        key={id}
        id={id}
        activeClassName={activeClassName}
        {...(hiddenClassName !== undefined ? { hiddenClassName } : {})}
      >
        {body}
      </KeepAlivePanel>
    );
  });
}
