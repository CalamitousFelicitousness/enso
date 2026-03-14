import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import type { SidebarGroup } from "./types";

interface FilterPanelProps {
  open: boolean;
  sidebarGroups: SidebarGroup[];
  selectedSubfolder: string;
  onSubfolderSelect: (subfolder: string) => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
}

export function FilterPanel({
  open,
  sidebarGroups,
  selectedSubfolder,
  onSubfolderSelect,
  anchorRef,
}: FilterPanelProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  const measure = useCallback(() => {
    if (anchorRef.current) {
      setRect(anchorRef.current.getBoundingClientRect());
    }
  }, [anchorRef]);

  useEffect(() => {
    if (!open || !anchorRef.current) {
      // Use cleanup-style reset via a microtask to avoid synchronous setState in effect body
      const id = requestAnimationFrame(() => setRect(null));
      return () => cancelAnimationFrame(id);
    }
    measure();
    const el = anchorRef.current;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, anchorRef, measure]);

  return createPortal(
    <AnimatePresence>
      {open && rect && (
        <>
          {/* Filter panel — anchored to left edge of NetworksTab, extending left */}
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 176, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="fixed z-50 overflow-hidden"
            style={{
              top: rect.top,
              right: window.innerWidth - rect.left,
              height: rect.height,
            }}
          >
            <div className="flex flex-col h-full w-44 overflow-y-auto overflow-x-hidden bg-card border border-r-0 border-border/50 shadow-lg dark:shadow-black/30 ring-1 dark:ring-white/[0.05] ring-black/[0.05] rounded-l-lg">
              <div className="py-2">
                {sidebarGroups.map((group, gi) => (
                  <div key={group.header ?? gi}>
                    {group.header && (
                      <div className="px-3 pt-3 pb-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground border-t border-border/40">
                        {group.header}
                      </div>
                    )}
                    {group.items.map((dir) => (
                      <button
                        key={dir}
                        type="button"
                        onClick={() => onSubfolderSelect(dir)}
                        className={cn(
                          "w-full text-left px-3 py-[5px] text-[0.6875rem] truncate transition-colors",
                          selectedSubfolder === dir
                            ? "bg-primary/15 text-primary font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                        )}
                      >
                        {dir}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
