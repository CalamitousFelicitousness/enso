import { useState, useRef } from "react";
import { cn } from "@/lib/utils";

interface SectionLeaderProps {
  variant?:
    | "inline-switch"
    | "full-track"
    | "leading-edge"
    | "underline-reveal"
    | "split-header"
    | "power-rail";
  title: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children?: React.ReactNode;
  className?: string;
}

// --- Shared content wrapper ---

function SectionContent({
  enabled,
  className,
  children,
}: {
  enabled: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 transition-opacity duration-250",
        !enabled && "opacity-35 pointer-events-none",
        className,
      )}
    >
      {children}
    </div>
  );
}

// --- Inline Switch: title left, compact pill switch right ---

function InlineSwitch({ title, enabled, onToggle, children }: SectionLeaderProps) {
  return (
    <div data-slot="section-leader" className="flex flex-col">
      <div className="flex items-center gap-2 py-[7px]">
        <span
          className={cn(
            "text-2xs font-medium uppercase tracking-[0.06em] transition-colors duration-200",
            enabled ? "text-muted-foreground" : "text-muted-foreground/40",
          )}
        >
          {title}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => onToggle(!enabled)}
          className={cn(
            "relative h-[14px] w-[26px] rounded-full shrink-0 transition-all duration-200 outline-none",
            "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
            enabled
              ? "bg-primary/20 ring-1 ring-primary/40"
              : "bg-muted/40 ring-1 ring-border/30",
          )}
        >
          <div
            className={cn(
              "absolute top-[2px] h-[10px] w-[10px] rounded-full transition-all duration-200",
              enabled
                ? "left-[14px] bg-primary shadow-[0_0_4px_oklch(from_var(--primary)_l_c_h_/_0.3)]"
                : "left-[2px] bg-muted-foreground/30",
            )}
          />
        </button>
      </div>
      <SectionContent enabled={enabled}>{children}</SectionContent>
    </div>
  );
}

// --- Full-Width Track: entire header bar is the toggle ---

function FullTrack({ title, enabled, onToggle, children }: SectionLeaderProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div data-slot="section-leader" className="flex flex-col">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => onToggle(!enabled)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={cn(
          "relative w-full h-[24px] rounded-md flex items-center px-2.5 text-left outline-none overflow-hidden",
          "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          "transition-all duration-250",
          enabled
            ? "bg-primary/10 ring-1 ring-primary/30"
            : hovered
              ? "bg-muted/30 ring-1 ring-border/25"
              : "bg-muted/20 ring-1 ring-border/15",
        )}
      >
        {/* Fill bar */}
        <div
          className={cn(
            "absolute inset-y-0 left-0 transition-all duration-300 ease-out rounded-md",
            enabled ? "bg-primary/8" : "bg-transparent",
          )}
          style={{ width: enabled ? "100%" : "0%" }}
        />
        {/* Edge line */}
        <div
          className={cn(
            "absolute top-[4px] bottom-[4px] w-[2px] rounded-full transition-all duration-300",
            enabled
              ? "bg-primary/50 shadow-[0_0_4px_oklch(from_var(--primary)_l_c_h_/_0.2)]"
              : "bg-transparent",
          )}
          style={{
            left: enabled ? "calc(100% - 6px)" : "4px",
            transition:
              "left 300ms cubic-bezier(0.25, 1, 0.5, 1), background-color 200ms, box-shadow 200ms",
          }}
        />
        {/* Title */}
        <span
          className={cn(
            "relative z-10 text-2xs font-medium uppercase tracking-[0.06em] transition-colors duration-200",
            enabled ? "text-primary/80" : "text-muted-foreground/50",
          )}
        >
          {title}
        </span>
        {/* Status */}
        <span
          className={cn(
            "relative z-10 ml-auto text-[9px] font-mono uppercase tracking-wider transition-colors duration-200",
            enabled ? "text-primary/40" : "text-muted-foreground/25",
          )}
        >
          {enabled ? "on" : "off"}
        </span>
      </button>
      <SectionContent enabled={enabled} className="mt-2">
        {children}
      </SectionContent>
    </div>
  );
}

// --- Leading Edge: vertical bar spans full section height ---

function LeadingEdge({ title, enabled, onToggle, children }: SectionLeaderProps) {
  return (
    <div data-slot="section-leader" className="flex">
      {/* Left edge bar */}
      <div
        className={cn(
          "shrink-0 rounded-full transition-all duration-300 mr-2.5 self-stretch",
          enabled
            ? "w-[3px] bg-primary/50 shadow-[0_0_6px_oklch(from_var(--primary)_l_c_h_/_0.2)]"
            : "w-[1.5px] bg-border/30",
        )}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => onToggle(!enabled)}
          className={cn(
            "flex items-center gap-2 py-[7px] text-left outline-none w-full",
            "focus-visible:ring-ring/50 focus-visible:ring-[3px] rounded-sm",
          )}
        >
          <span
            className={cn(
              "text-2xs font-medium uppercase tracking-[0.06em] transition-colors duration-200",
              enabled ? "text-foreground/80" : "text-muted-foreground/40",
            )}
          >
            {title}
          </span>
          {/* Dot indicator */}
          <div
            className={cn(
              "h-[5px] w-[5px] rounded-full transition-all duration-300 ml-1",
              enabled
                ? "bg-primary/60 shadow-[0_0_4px_oklch(from_var(--primary)_l_c_h_/_0.3)]"
                : "bg-muted-foreground/20",
            )}
          />
        </button>
        <SectionContent enabled={enabled}>{children}</SectionContent>
      </div>
    </div>
  );
}

// --- Underline Reveal: full-width line as state indicator ---

function UnderlineReveal({ title, enabled, onToggle, children }: SectionLeaderProps) {
  return (
    <div data-slot="section-leader" className="flex flex-col">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => onToggle(!enabled)}
        className={cn(
          "flex items-center gap-2 py-[7px] text-left outline-none w-full",
          "focus-visible:ring-ring/50 focus-visible:ring-[3px] rounded-sm",
        )}
      >
        <span
          className={cn(
            "text-2xs font-medium uppercase tracking-[0.06em] transition-colors duration-200",
            enabled ? "text-primary/70" : "text-muted-foreground/40",
          )}
        >
          {title}
        </span>
        <div className="flex-1" />
        <span
          className={cn(
            "text-[8px] font-mono uppercase tracking-wider transition-colors duration-200",
            enabled ? "text-primary/35" : "text-muted-foreground/20",
          )}
        >
          {enabled ? "enabled" : "disabled"}
        </span>
      </button>
      {/* Full-width underline */}
      <div className="relative h-[1px] w-full mb-2">
        {/* Muted dashed line (off state) */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: enabled
              ? "none"
              : "repeating-linear-gradient(to right, oklch(from var(--muted-foreground) l c h / 0.15) 0px, oklch(from var(--muted-foreground) l c h / 0.15) 3px, transparent 3px, transparent 7px)",
          }}
        />
        {/* Primary sweep */}
        <div
          className={cn(
            "absolute inset-y-0 left-0 transition-all duration-350 ease-out rounded-full",
            enabled
              ? "bg-primary/40 shadow-[0_0_6px_oklch(from_var(--primary)_l_c_h_/_0.15)]"
              : "bg-transparent",
          )}
          style={{ width: enabled ? "100%" : "0%" }}
        />
      </div>
      <SectionContent enabled={enabled}>{children}</SectionContent>
    </div>
  );
}

// --- Split Header: title zone + explicit OFF button ---

function SplitHeader({ title, enabled, onToggle, children }: SectionLeaderProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div data-slot="section-leader" className="flex flex-col">
      <div
        className={cn(
          "relative flex items-center h-[24px] rounded-md overflow-hidden transition-all duration-200 ring-1",
          enabled
            ? "ring-primary/25 bg-primary/5"
            : hovered
              ? "ring-border/25 bg-muted/20"
              : "ring-border/15 bg-muted/10",
        )}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Sliding highlight */}
        <div
          className={cn(
            "absolute top-[2px] bottom-[2px] rounded-[4px]",
            enabled ? "bg-primary/15" : "bg-muted-foreground/8",
          )}
          style={{
            left: enabled ? "2px" : "calc(100% - 50px)",
            width: enabled ? "calc(100% - 54px)" : "48px",
            transition:
              "left 250ms cubic-bezier(0.25, 1, 0.5, 1), width 250ms cubic-bezier(0.25, 1, 0.5, 1), background-color 200ms",
          }}
        />
        {/* Title zone */}
        <button
          type="button"
          onClick={() => !enabled && onToggle(true)}
          className={cn(
            "relative z-10 flex-1 flex items-center px-2.5 h-full text-left outline-none",
            "focus-visible:ring-ring/50 focus-visible:ring-[3px] rounded-l-md",
          )}
        >
          <span
            className={cn(
              "text-2xs font-medium uppercase tracking-[0.06em] transition-colors duration-200",
              enabled ? "text-primary/80" : "text-muted-foreground/35",
            )}
          >
            {title}
          </span>
        </button>
        {/* Divider */}
        <div
          className={cn(
            "w-[1px] h-[12px] transition-colors duration-200",
            enabled ? "bg-primary/15" : "bg-border/20",
          )}
        />
        {/* OFF zone */}
        <button
          type="button"
          onClick={() => enabled && onToggle(false)}
          className={cn(
            "relative z-10 w-[48px] flex items-center justify-center h-full outline-none",
            "focus-visible:ring-ring/50 focus-visible:ring-[3px] rounded-r-md",
          )}
        >
          <span
            className={cn(
              "text-[8px] font-mono uppercase tracking-wider transition-colors duration-200",
              !enabled ? "text-muted-foreground/50" : "text-muted-foreground/25",
            )}
          >
            off
          </span>
        </button>
      </div>
      <SectionContent enabled={enabled} className="mt-2">
        {children}
      </SectionContent>
    </div>
  );
}

// --- Power Rail: glowing dot + illuminating horizontal rail ---

function PowerRail({ title, enabled, onToggle, children }: SectionLeaderProps) {
  const [pulsing, setPulsing] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout>>(null);

  const handleToggle = () => {
    setPulsing(true);
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setPulsing(false), 400);
    onToggle(!enabled);
  };

  return (
    <div data-slot="section-leader" className="flex flex-col">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={handleToggle}
        className={cn(
          "flex items-center gap-2 py-[7px] text-left outline-none w-full group",
          "focus-visible:ring-ring/50 focus-visible:ring-[3px] rounded-sm",
        )}
      >
        {/* Power dot */}
        <div className="relative shrink-0">
          <div
            className={cn(
              "h-[7px] w-[7px] rounded-full transition-all duration-300",
              enabled
                ? "bg-primary shadow-[0_0_6px_oklch(from_var(--primary)_l_c_h_/_0.4)]"
                : "bg-muted-foreground/20 group-hover:bg-muted-foreground/30",
            )}
          />
          {pulsing && enabled && (
            <div
              className="absolute inset-0 rounded-full animate-ping bg-primary/30"
              style={{ animationDuration: "400ms", animationIterationCount: "1" }}
            />
          )}
        </div>
        {/* Title */}
        <span
          className={cn(
            "text-2xs font-medium uppercase tracking-[0.06em] transition-colors duration-200 shrink-0",
            enabled ? "text-foreground/80" : "text-muted-foreground/35",
          )}
        >
          {title}
        </span>
        {/* Rail line */}
        <div className="flex-1 h-[1px] relative">
          <div className="absolute inset-0 bg-border/20" />
          <div
            className={cn(
              "absolute inset-y-0 left-0 transition-all duration-400 ease-out",
              enabled ? "bg-primary/30" : "bg-transparent",
            )}
            style={{ width: enabled ? "100%" : "0%" }}
          />
          {enabled && (
            <div
              className="absolute inset-y-[-1px] left-0 transition-all duration-400 ease-out"
              style={{
                width: "100%",
                background:
                  "linear-gradient(to right, oklch(from var(--primary) l c h / 0.15), transparent)",
              }}
            />
          )}
        </div>
      </button>
      <SectionContent enabled={enabled}>{children}</SectionContent>
    </div>
  );
}

// --- Main SectionLeader component ---

function SectionLeader({ variant = "leading-edge", ...props }: SectionLeaderProps) {
  switch (variant) {
    case "inline-switch":
      return <InlineSwitch {...props} />;
    case "full-track":
      return <FullTrack {...props} />;
    case "leading-edge":
      return <LeadingEdge {...props} />;
    case "underline-reveal":
      return <UnderlineReveal {...props} />;
    case "split-header":
      return <SplitHeader {...props} />;
    case "power-rail":
      return <PowerRail {...props} />;
  }
}

export { SectionLeader };
export type { SectionLeaderProps };
