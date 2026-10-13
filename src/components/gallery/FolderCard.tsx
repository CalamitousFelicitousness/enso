import type { LucideIcon } from "lucide-react";
import { Folder, FolderOpen, ChevronRight, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface FolderCardProps {
  label: string;
  path: string;
  active: boolean;
  indent?: number;
  expanded?: boolean;
  hasChildren?: boolean;
  loading?: boolean;
  /** In place of the folder icon. */
  icon?: LucideIcon;
  /** How many files it holds, beside the label; left out of its accessible name. */
  count?: number | null;
  /** The hover text; the path when not given. */
  title?: string;
  onSelect: () => void;
  onToggle?: () => void;
}

export function FolderCard({
  label,
  path,
  active,
  indent = 0,
  expanded,
  hasChildren,
  loading,
  icon,
  count = null,
  title,
  onSelect,
  onToggle,
}: FolderCardProps) {
  const Icon = icon ?? (active ? FolderOpen : Folder);
  const displayLabel = label || path.split("/").filter(Boolean).pop() || path;

  return (
    <div
      className={cn(
        "flex items-center w-full rounded-md text-xs transition-colors group",
        "hover:bg-accent/50",
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground",
      )}
      style={{ paddingLeft: indent * 16 + 4 }}
    >
      {/* Expand/collapse toggle */}
      {loading ? (
        <span className="w-5 h-5 flex items-center justify-center flex-shrink-0">
          <Loader2 size={12} className="animate-spin text-muted-foreground" />
        </span>
      ) : hasChildren ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.();
          }}
          className="w-5 h-5 flex items-center justify-center flex-shrink-0 hover:text-foreground"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      ) : (
        <span className="w-5 flex-shrink-0" />
      )}

      {/* Folder button */}
      <button
        onClick={onSelect}
        aria-current={active || undefined}
        className="flex items-center gap-1.5 flex-1 min-w-0 py-1.5 pr-2"
        title={title ?? path}
      >
        <Icon
          size={13}
          className={cn("flex-shrink-0", active ? "text-primary" : "text-muted-foreground")}
        />

        <span className="truncate">{displayLabel}</span>
        {count !== null && (
          <span
            aria-hidden
            className="ml-auto shrink-0 font-mono tabular-nums text-3xs text-muted-foreground"
          >
            {count.toLocaleString("en-US")}
          </span>
        )}
      </button>
    </div>
  );
}
