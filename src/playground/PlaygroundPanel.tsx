import { cn } from "@/lib/utils";

interface PlaygroundPanelProps {
  title: string;
  /** Label shown above the title (e.g., "current" or "variant a") */
  tag?: string;
  width?: number;
  /** Fixed height. Use for panels that manage their own internal scroll (h-full + overflow-y-auto).
   *  When set, the panel body gets this exact height and no overflow — the child handles scrolling. */
  height?: number;
  children: React.ReactNode;
  className?: string;
}

/**
 * Container that mimics a real sidebar panel for playground prototyping.
 * Fixed width, card styling. Supports two modes:
 * - Default: max-height with overflow-y-auto (for simple content)
 * - Fixed height: exact height, no overflow (for panels with internal scroll like NetworksTab)
 */
export function PlaygroundPanel({
  title,
  tag,
  width = 280,
  height,
  children,
  className,
}: PlaygroundPanelProps) {
  return (
    <div className="flex flex-col items-center gap-2">
      {/* Header label */}
      <div className="flex items-center gap-2">
        {tag && (
          <span className="text-[9px] font-mono text-muted-foreground/40 bg-muted/30 px-1.5 h-4 rounded flex items-center justify-center shrink-0 uppercase">
            {tag}
          </span>
        )}
        <span className="text-3xs font-medium uppercase tracking-[0.06em] text-muted-foreground/60">
          {title}
        </span>
      </div>

      {/* Panel body */}
      <div
        className={cn(
          "bg-card rounded-lg border border-border/30 ring-1 ring-border/10 isolate relative",
          height ? "overflow-hidden" : "p-3 overflow-y-auto max-h-[600px]",
          className,
        )}
        style={{ width, height }}
      >
        {children}
      </div>
    </div>
  );
}
