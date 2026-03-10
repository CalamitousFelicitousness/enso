import { useState, useCallback, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ParamSectionProps {
  title: string;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  count?: number;
  accent?: boolean;
  children: React.ReactNode;
}

export function ParamSection({
  title,
  defaultOpen = true,
  action,
  count,
  accent,
  children,
}: ParamSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowRight" && !open) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "ArrowLeft" && open) {
        e.preventDefault();
        setOpen(false);
      }
    },
    [open],
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ section: string }>).detail;
      if (detail.section === title.toLowerCase()) setOpen(true);
    };
    document.addEventListener("param-section-expand", handler);
    return () => document.removeEventListener("param-section-expand", handler);
  }, [title]);

  return (
    <div data-section={title.toLowerCase()}>
      <button
        type="button"
        onClick={toggle}
        onKeyDown={handleKeyDown}
        className="w-full flex items-center gap-1.5 py-[7px] group text-left transition-colors"
      >
        <ChevronRight
          size={9}
          strokeWidth={2}
          className={cn(
            "text-muted-foreground/50 transition-transform duration-150 shrink-0",
            open && "rotate-90",
          )}
        />
        <span className="font-sans text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground group-hover:text-foreground transition-colors leading-none">
          {title}
        </span>
        {count != null && count > 0 && (
          <span className="font-mono text-[9px] tabular-nums text-muted-foreground/40 leading-none ml-0.5">
            {count}
          </span>
        )}
        <span className="flex-1" />
        {action && (
          <span
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {action}
          </span>
        )}
      </button>
      {open && (
        <div
          className={cn(
            "flex flex-col gap-1.5 pb-0.5",
            accent && "pl-2 border-l border-primary/20 ml-[3px]",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function SectionDivider() {
  return <div className="h-px bg-border/40" />;
}
