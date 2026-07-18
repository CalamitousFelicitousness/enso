import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useDownloadStore } from "@/stores/downloadStore";
import { useCivitDownloadCancel, useCivitDownloadStatus } from "@/api/hooks/useCivitai";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function statusColor(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "downloading":
    case "verifying":
      return "default";
    case "completed":
      return "secondary";
    case "failed":
    case "cancelled":
      return "destructive";
    default:
      return "outline";
  }
}

export function CivitDownloadQueue() {
  const [open, setOpen] = useState(false);
  const wsItems = useDownloadStore((s) => s.items);
  const { data: statusData } = useCivitDownloadStatus();
  const cancelDownload = useCivitDownloadCancel();
  const qc = useQueryClient();

  // Merge WS real-time items with REST status for completed/queued
  const activeItems = wsItems.length > 0 ? wsItems : (statusData?.active ?? []);
  const queuedItems = statusData?.queued ?? [];
  const completedItems = statusData?.completed ?? [];
  const totalCount = activeItems.length + queuedItems.length + completedItems.length;
  // Backend appends to a bounded deque, so completed arrives oldest-first and
  // is already length-capped; copy before reversing to avoid mutating the
  // query cache.
  const completedNewestFirst = [...completedItems].reverse();

  // Invalidate check-local when downloads newly complete. The backend holds
  // completed in a bounded deque, so its length stops growing once saturated;
  // track ids. Seed silently so mount doesn't refetch for already-seen items.
  const seenCompleted = useRef<Set<string> | null>(null);
  useEffect(() => {
    const done = (statusData?.completed ?? []).filter((d) => d.status === "completed");
    if (seenCompleted.current === null) {
      seenCompleted.current = new Set(done.map((d) => d.id));
      return;
    }
    let fresh = false;
    for (const d of done) {
      if (!seenCompleted.current.has(d.id)) {
        seenCompleted.current.add(d.id);
        fresh = true;
      }
    }
    if (fresh) void qc.invalidateQueries({ queryKey: ["civitai-check-local"] });
  }, [statusData, qc]);

  if (totalCount === 0) return null;

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/30"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="text-xs font-medium">Downloads ({totalCount})</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-1.5 max-h-64 overflow-y-auto">
          {activeItems.map((item) => (
            <div key={item.id} className="space-y-1">
              <div className="flex items-center gap-2 text-2xs">
                <span className="truncate flex-1 min-w-0" title={item.filename}>
                  {item.filename}
                </span>
                <Badge variant={statusColor(item.status)} className="text-4xs px-1 py-0">
                  {item.status}
                </Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5 shrink-0"
                  onClick={() => cancelDownload.mutate(item.id)}
                >
                  <X className="h-2.5 w-2.5" />
                </Button>
              </div>
              <div className="h-1.5 rounded bg-primary/20 overflow-hidden">
                <div
                  className={cn("h-full bg-primary rounded transition-all")}
                  style={{ width: `${(item.progress * 100).toFixed(1)}%` }}
                />
              </div>
            </div>
          ))}
          {queuedItems.map((item) => (
            <div key={item.id} className="flex items-center gap-2 text-2xs">
              <span className="truncate flex-1 min-w-0" title={item.filename}>
                {item.filename}
              </span>
              <Badge variant="outline" className="text-4xs px-1 py-0">
                queued
              </Badge>
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5 shrink-0"
                onClick={() => cancelDownload.mutate(item.id)}
              >
                <X className="h-2.5 w-2.5" />
              </Button>
            </div>
          ))}
          {completedNewestFirst.map((item) => (
            <div key={item.id} className="flex items-center gap-2 text-2xs text-muted-foreground">
              <span className="truncate flex-1 min-w-0" title={item.filename}>
                {item.filename}
              </span>
              <Badge variant={statusColor(item.status)} className="text-4xs px-1 py-0">
                {item.status}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
