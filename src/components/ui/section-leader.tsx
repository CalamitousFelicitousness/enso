import { memo, useState, useCallback, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface SectionLeaderProps {
  title: string;
  /** Can this section be collapsed? */
  collapsible?: boolean;
  /** Start collapsed? Only applies when collapsible. */
  defaultCollapsed?: boolean;
  /** Can this section be enabled/disabled? */
  enableable?: boolean;
  /** Current enabled state (only matters if enableable). */
  enabled?: boolean;
  onToggleEnabled?: (v: boolean) => void;
  /** Nesting level — 0 (top), 1 (nested), 2 (inline sub-header, no bar). */
  level?: 0 | 1 | 2;
  /** When true, the entire section is visually disabled (parent is off). */
  parentDisabled?: boolean;
  /** Action slot — rendered in the header row, right-aligned. */
  action?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * Unified section leader — 2×2 collapse × enable matrix.
 *
 * Every section gets a left-edge bar for visual cohesion.
 * Bar color communicates enable state; neutral for non-enableable.
 * Indicators (dot, chevron) are left-anchored before the title.
 *
 *   [bar] • TITLE              — enableable
 *   [bar] ▾ TITLE              — collapsible (entire row clickable)
 *   [bar] • TITLE          ▾   — both (dot=enable, chevron=collapse)
 *   [bar]   TITLE              — neither
 *         ▾ TITLE              — level 2 (no bar, inline sub-header)
 */
const SectionLeader = memo(function SectionLeader({
  title,
  collapsible = false,
  defaultCollapsed = false,
  enableable = false,
  enabled = true,
  onToggleEnabled,
  level = 0,
  parentDisabled = false,
  action,
  children,
}: SectionLeaderProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const isActive = enableable ? enabled && !parentDisabled : !parentDisabled;
  const hasBar = level < 2;
  const barWidth = level === 0 ? "w-[3px]" : "w-[2px]";
  const titleSize = level === 2 ? "text-3xs" : level === 1 ? "text-[10px]" : "text-2xs";
  const dotSize = level === 2 ? "h-[3px] w-[3px]" : level === 1 ? "h-[4px] w-[4px]" : "h-[5px] w-[5px]";
  const headerPy = level === 0 ? "py-[7px]" : level === 1 ? "py-1" : "py-0.5";

  // Programmatic expand via custom event (used by navigateToParam.ts)
  useEffect(() => {
    if (!collapsible) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ section: string }>).detail;
      if (detail.section === title.toLowerCase()) setCollapsed(false);
    };
    document.addEventListener("param-section-expand", handler);
    return () => document.removeEventListener("param-section-expand", handler);
  }, [collapsible, title]);

  // Keyboard: ArrowRight expands, ArrowLeft collapses
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!collapsible) return;
      if (e.key === "ArrowRight" && collapsed) {
        e.preventDefault();
        setCollapsed(false);
      } else if (e.key === "ArrowLeft" && !collapsed) {
        e.preventDefault();
        setCollapsed(true);
      }
    },
    [collapsible, collapsed],
  );

  const toggleCollapse = useCallback(() => setCollapsed((c) => !c), []);

  // --- Action slot (with propagation isolation) ---
  const actionSlot = action ? (
    <span
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="ml-1.5"
    >
      {action}
    </span>
  ) : null;

  // --- Chevron element ---
  const chevron = (
    <ChevronDown
      className={cn(
        "w-3 h-3 transition-transform duration-200",
        collapsed && "-rotate-90",
      )}
    />
  );

  // --- Bar color ---
  let barColor: string;
  if (enableable) {
    if (isActive) {
      barColor =
        level === 0
          ? "bg-primary/50 shadow-[0_0_6px_oklch(from_var(--primary)_l_c_h_/_0.2)]"
          : "bg-primary/35 shadow-[0_0_3px_oklch(from_var(--primary)_l_c_h_/_0.1)]";
    } else {
      barColor = "bg-border/20";
    }
  } else {
    barColor = "bg-border/30";
  }

  // --- Header rendering ---
  let header: React.ReactNode;

  if (!enableable && collapsible) {
    // Collapse-only: chevron + title are the toggle, action is a sibling
    header = (
      <div className={cn("flex items-center w-full", headerPy)}>
        <button
          type="button"
          onClick={toggleCollapse}
          onKeyDown={handleKeyDown}
          aria-expanded={!collapsed}
          className={cn(
            "flex items-center gap-1.5 text-left outline-none transition-colors group",
            "focus-visible:ring-ring/50 focus-visible:ring-[3px] rounded-sm",
          )}
        >
          <span className="text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-colors shrink-0">
            {chevron}
          </span>
          <span
            className={cn(
              titleSize,
              "font-medium uppercase tracking-[0.06em] text-muted-foreground group-hover:text-foreground transition-colors",
            )}
          >
            {title}
          </span>
        </button>
        {actionSlot}
      </div>
    );
  } else if (enableable) {
    // Enable-only or Both: dot left-anchored before title
    header = (
      <div
        className={cn(
          "flex items-center w-full rounded-sm",
          headerPy,
        )}
      >
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-disabled={parentDisabled}
          onClick={() => !parentDisabled && onToggleEnabled?.(!enabled)}
          className="flex items-center gap-1.5 text-left outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] rounded-sm"
        >
          <div
            className={cn(
              "rounded-full transition-all duration-300 shrink-0",
              dotSize,
              isActive
                ? "bg-primary/60 shadow-[0_0_4px_oklch(from_var(--primary)_l_c_h_/_0.3)]"
                : "bg-muted-foreground/15",
            )}
          />
          <span
            className={cn(
              titleSize,
              "font-medium uppercase tracking-[0.06em] transition-colors duration-200",
              isActive
                ? "text-foreground/80"
                : "text-muted-foreground/35",
            )}
          >
            {title}
          </span>
        </button>

        {actionSlot}

        {collapsible && (
          <button
            type="button"
            onClick={toggleCollapse}
            onKeyDown={handleKeyDown}
            aria-expanded={!collapsed}
            className={cn(
              "ml-auto p-0.5 rounded-sm outline-none transition-colors duration-200",
              "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
              "text-muted-foreground/30 hover:text-muted-foreground/60",
            )}
          >
            {chevron}
          </button>
        )}
      </div>
    );
  } else {
    // Neither: plain label
    header = (
      <div
        className={cn(
          "flex items-center w-full",
          headerPy,
        )}
      >
        <span
          className={cn(
            titleSize,
            "font-medium uppercase tracking-[0.06em] text-muted-foreground/60",
          )}
        >
          {title}
        </span>
        {actionSlot}
      </div>
    );
  }

  return (
    <div
      data-section={title.toLowerCase()}
      className={cn(
        "flex",
        parentDisabled && "opacity-40 pointer-events-none",
      )}
    >
      {/* Left edge bar — present at level 0 and 1 for visual cohesion */}
      {hasBar && (
        <div
          className={cn(
            "shrink-0 rounded-full transition-all duration-300 mr-2 self-stretch",
            barWidth,
            barColor,
          )}
        />
      )}

      {/* Content column */}
      <div className="flex-1 flex flex-col min-w-0">
        {header}

        {/* Children — hidden when collapsed, dimmed when disabled */}
        {!collapsed && children && (
          <div
            className={cn(
              "flex flex-col gap-1.5",
              enableable && !enabled && !parentDisabled && "opacity-35 pointer-events-none",
            )}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
});

function SectionDivider({ label }: { label?: string }) {
  if (!label) return <div className="h-px bg-border/40" />;
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-3xs font-medium uppercase tracking-[0.06em] text-muted-foreground/40 shrink-0">
        {label}
      </span>
      <div className="flex-1 h-px bg-border/30" />
    </div>
  );
}

export { SectionLeader, SectionDivider };
export type { SectionLeaderProps };
