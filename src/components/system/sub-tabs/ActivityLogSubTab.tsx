import { useMemo, useState } from "react";
import { useHistory } from "@/api/hooks/useSystem";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";
import { formatDuration } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertCircle, ChevronDown, ChevronRight } from "lucide-react";
import type { HistoryEntryV2 } from "@/api/types/system";

function entryKey(entry: HistoryEntryV2): string {
  if (entry.id != null) return `id:${entry.id}`;
  return `syn:${entry.timestamp ?? 0}:${entry.op}:${entry.outputs?.[0] ?? ""}`;
}

export function ActivityLogSubTab() {
  const visible = useKeepAliveVisible();
  const { data: history, isLoading, isError, error, refetch } = useHistory({}, visible);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const items = history?.items ?? [];
    if (!filter) return items;
    const q = filter.toLowerCase();
    return items.filter((entry) => {
      return (
        entry.job?.toLowerCase().includes(q) ||
        entry.op?.toLowerCase().includes(q) ||
        entry.outputs?.some((o) => o.toLowerCase().includes(q))
      );
    });
  }, [history?.items, filter]);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <Input
        placeholder="Filter activity..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="h-6 text-2xs"
      />

      {isLoading && (
        <p className="text-xs text-muted-foreground text-center py-4">Loading activity...</p>
      )}

      {isError && (
        <div className="flex flex-col items-center gap-1.5 px-3 py-4">
          <AlertCircle className="h-4 w-4 text-destructive" />
          <p className="text-xs text-destructive text-center">
            {error instanceof Error ? error.message : "Failed to load activity"}
          </p>
          <Button size="sm" variant="ghost" className="h-6 text-2xs" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">No activity entries</p>
      )}

      {!isLoading && !isError && filtered.length > 0 && (
        <div className="space-y-0.5">
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 text-3xs font-medium text-muted-foreground px-2 pb-1 border-b border-border">
            <span>Job / Op</span>
            <span>Duration</span>
            <span>Time</span>
          </div>
          {filtered.map((entry) => {
            const key = entryKey(entry);
            const hasOutputs = entry.outputs && entry.outputs.length > 0;
            const isExpanded = expanded.has(key);
            return (
              <div key={key}>
                <button
                  type="button"
                  className="w-full grid grid-cols-[1fr_auto_auto] gap-2 items-center text-xs px-2 py-1 rounded hover:bg-muted/50 text-left"
                  onClick={() => hasOutputs && toggle(key)}
                >
                  <span className="truncate flex items-center gap-1">
                    {hasOutputs &&
                      (isExpanded ? (
                        <ChevronDown className="h-3 w-3 shrink-0" />
                      ) : (
                        <ChevronRight className="h-3 w-3 shrink-0" />
                      ))}
                    <span className="font-medium">{entry.op}</span>
                    {entry.job && <span className="text-muted-foreground">({entry.job})</span>}
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground text-2xs">
                    {entry.duration != null ? formatDuration(entry.duration) : "-"}
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground text-2xs">
                    {entry.timestamp ? new Date(entry.timestamp * 1000).toLocaleTimeString() : "-"}
                  </span>
                </button>
                {isExpanded && hasOutputs && (
                  <div className="pl-7 pr-2 pb-1 space-y-0.5">
                    {entry.outputs.map((output, j) => (
                      <p key={j} className="text-3xs text-muted-foreground truncate">
                        {output}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
