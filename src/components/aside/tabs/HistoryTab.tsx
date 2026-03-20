import { useState, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Trash2,
  Filter,
  History,
  Image,
  Video,
  Sparkles,
  MessageSquare,
  ScanSearch,
  SlidersHorizontal,
  LayoutGrid,
} from "lucide-react";
import { useJobList, useBulkJobAction } from "@/api/hooks/useJobs";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { HistoryJobCard } from "./HistoryJobCard";
import { ScrollArea } from "@/components/ui/scroll-area";

const PAGE_SIZE = 20;

type StatusFilter = "all" | "completed" | "failed" | "cancelled";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "completed", label: "Done" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

const TYPE_FILTERS: { value: string; label: string; icon: typeof Image }[] = [
  { value: "", label: "All types", icon: Filter },
  { value: "generate", label: "Generate", icon: Image },
  { value: "upscale", label: "Upscale", icon: Sparkles },
  { value: "caption", label: "Caption", icon: MessageSquare },
  { value: "enhance", label: "Enhance", icon: Sparkles },
  { value: "detect", label: "Detect", icon: ScanSearch },
  { value: "preprocess", label: "Preprocess", icon: SlidersHorizontal },
  { value: "video", label: "Video", icon: Video },
  { value: "framepack", label: "FramePack", icon: Video },
  { value: "ltx", label: "LTX", icon: Video },
  { value: "xyz-grid", label: "XYZ Grid", icon: LayoutGrid },
];

export function HistoryTab() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(0);

  const queryStatus = statusFilter === "all" ? undefined : statusFilter;
  const queryType = typeFilter || undefined;

  const { data, isLoading } = useJobList({
    status: queryStatus,
    type: queryType,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const bulkAction = useBulkJobAction();

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const handleStatusChange = useCallback((value: StatusFilter) => {
    setStatusFilter(value);
    setPage(0);
  }, []);

  const handleTypeChange = useCallback((value: string) => {
    setTypeFilter(value);
    setPage(0);
  }, []);

  const handleBulkDelete = useCallback(() => {
    const filters: Record<string, string> = {};
    if (queryStatus) filters.status = queryStatus;
    if (queryType) filters.type = queryType;
    // Need at least one filter — use status "completed" + "failed" + "cancelled" via individual calls
    // or if no filter is set, default to targeting all terminal statuses
    const status = queryStatus ?? "completed";
    bulkAction.mutate({
      action: "delete",
      status,
      type: queryType,
    });
  }, [queryStatus, queryType, bulkAction]);

  const activeTypeLabel =
    TYPE_FILTERS.find((t) => t.value === typeFilter)?.label ?? "All types";

  const hasFilters = statusFilter !== "all" || typeFilter !== "";

  return (
    <div className="flex flex-col h-full">
      {/* Sticky filter bar */}
      <div className="shrink-0 border-b border-border px-3 py-2 space-y-2">
        <SegmentedControl
          options={STATUS_OPTIONS}
          value={statusFilter}
          onValueChange={handleStatusChange}
          variant="dense"
          className="w-full"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start text-2xs h-6"
            >
              <Filter className="h-3 w-3 mr-1.5" />
              {activeTypeLabel}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {TYPE_FILTERS.map((item) => (
              <DropdownMenuItem
                key={item.value}
                onClick={() => handleTypeChange(item.value)}
                className="text-xs gap-2"
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Scrollable job list */}
      <ScrollArea className="flex-1">
        <div className="py-1">
          {isLoading && (
            <p className="text-xs text-muted-foreground px-3 py-4 text-center">
              Loading...
            </p>
          )}

          {!isLoading && data && data.items.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-3 py-8 text-muted-foreground">
              <History className="h-8 w-8 opacity-30" />
              <p className="text-xs text-center">
                {hasFilters
                  ? "No jobs match the current filters."
                  : "No job history yet."}
              </p>
            </div>
          )}

          {data?.items.map((job) => (
            <HistoryJobCard key={job.id} job={job} />
          ))}
        </div>
      </ScrollArea>

      {/* Sticky footer */}
      {data && data.total > 0 && (
        <div className="shrink-0 border-t border-border px-3 py-2 space-y-1.5">
          {/* Pagination */}
          <div className="flex items-center justify-between">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-3xs text-muted-foreground font-mono tabular-nums">
              {page + 1} / {totalPages}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Bulk delete */}
          <Button
            variant="outline"
            size="sm"
            className="w-full text-2xs h-6 text-destructive hover:text-destructive"
            onClick={handleBulkDelete}
            disabled={bulkAction.isPending}
          >
            <Trash2 className="h-3 w-3 mr-1.5" />
            {bulkAction.isPending
              ? "Deleting..."
              : `Delete ${hasFilters ? "filtered" : "all"} (${data.total})`}
          </Button>
        </div>
      )}
    </div>
  );
}
