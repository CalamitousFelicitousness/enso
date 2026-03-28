import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SidebarGroup, FolderNode } from "./types";

interface FilterPanelProps {
  open: boolean;
  sidebarGroups: SidebarGroup[];
  folderTree: FolderNode[];
  classFolders: Map<string, FolderNode[]>;
  selectedSubfolder: string;
  onSubfolderSelect: (subfolder: string) => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
}

function FolderTreeRow({
  node,
  depth,
  selected,
  expanded,
  onSelect,
  onToggle,
}: {
  node: FolderNode;
  depth: number;
  selected: string;
  expanded: Set<string>;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.path);
  const selectedPath = selected.startsWith("folder:") ? selected.slice(7) : "";
  const isActive = selectedPath === node.path;
  const isAncestor = !isActive && selectedPath.startsWith(node.path + "/");

  return (
    <>
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        className={cn(
          "w-full text-left py-[5px] pr-3 text-[0.6875rem] truncate transition-colors flex items-center gap-1",
          isActive
            ? "bg-primary/15 text-primary font-medium"
            : isAncestor
              ? "text-foreground/80"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
        )}
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        {hasChildren ? (
          <span
            role="button"
            className="shrink-0 p-0.5 -ml-0.5 rounded hover:bg-muted/80"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.path);
            }}
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </span>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {hasChildren && isExpanded &&
        node.children.map((child) => (
          <FolderTreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            selected={selected}
            expanded={expanded}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        ))}
    </>
  );
}

export function FilterPanel({
  open,
  sidebarGroups,
  folderTree,
  classFolders,
  selectedSubfolder,
  onSubfolderSelect,
  anchorRef,
}: FilterPanelProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const measure = useCallback(() => {
    if (anchorRef.current) {
      setRect(anchorRef.current.getBoundingClientRect());
    }
  }, [anchorRef]);

  useEffect(() => {
    if (!open || !anchorRef.current) {
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

  const toggleExpand = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Auto-expand ancestors of the selected folder so it's always visible
  const handleSelect = useCallback(
    (path: string) => {
      onSubfolderSelect("folder:" + path);
      // Expand all ancestors
      const segments = path.split("/");
      if (segments.length > 1) {
        setExpanded((prev) => {
          const next = new Set(prev);
          let ancestor = "";
          for (let i = 0; i < segments.length - 1; i++) {
            ancestor = ancestor ? `${ancestor}/${segments[i]}` : segments[i];
            next.add(ancestor);
          }
          return next;
        });
      }
    },
    [onSubfolderSelect],
  );

  return createPortal(
    <AnimatePresence>
      {open && rect && (
        <>
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
                    {group.items.map((dir) => {
                      const children = classFolders.get(dir);
                      const hasChildren = children && children.length > 0;
                      const isExpanded = expanded.has(dir);
                      return (
                        <div key={dir}>
                          <button
                            type="button"
                            onClick={() => onSubfolderSelect(dir)}
                            className={cn(
                              "w-full text-left px-3 py-[5px] text-[0.6875rem] truncate transition-colors flex items-center gap-1",
                              selectedSubfolder === dir
                                ? "bg-primary/15 text-primary font-medium"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                            )}
                          >
                            {hasChildren ? (
                              <span
                                role="button"
                                className="shrink-0 p-0.5 -ml-0.5 rounded hover:bg-muted/80"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleExpand(dir);
                                }}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-3 w-3" />
                                ) : (
                                  <ChevronRight className="h-3 w-3" />
                                )}
                              </span>
                            ) : null}
                            <span className="truncate">{dir}</span>
                          </button>
                          {hasChildren && isExpanded &&
                            children.map((node) => (
                              <FolderTreeRow
                                key={node.path}
                                node={node}
                                depth={1}
                                selected={selectedSubfolder}
                                expanded={expanded}
                                onSelect={handleSelect}
                                onToggle={toggleExpand}
                              />
                            ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
                {folderTree.length > 0 && (
                  <div>
                    <div className="px-3 pt-3 pb-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground border-t border-border/40">
                      Folders
                    </div>
                    {folderTree.map((node) => (
                      <FolderTreeRow
                        key={node.path}
                        node={node}
                        depth={0}
                        selected={selectedSubfolder}
                        expanded={expanded}
                        onSelect={handleSelect}
                        onToggle={toggleExpand}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
