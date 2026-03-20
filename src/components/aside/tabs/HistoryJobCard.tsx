import {
  Image,
  Video,
  Sparkles,
  MessageSquare,
  ScanSearch,
  SlidersHorizontal,
  LayoutGrid,
  Eye,
  Trash2,
  RotateCcw,
} from "lucide-react";
import type { Job } from "@/api/types/v2";
import { useDeleteJob } from "@/api/hooks/useJobs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const TYPE_ICONS: Record<string, typeof Image> = {
  generate: Image,
  upscale: Sparkles,
  caption: MessageSquare,
  enhance: Sparkles,
  detect: ScanSearch,
  preprocess: SlidersHorizontal,
  video: Video,
  framepack: Video,
  ltx: Video,
  "xyz-grid": LayoutGrid,
};

const TYPE_LABELS: Record<string, string> = {
  generate: "Generate",
  upscale: "Upscale",
  caption: "Caption",
  enhance: "Enhance",
  detect: "Detect",
  preprocess: "Preprocess",
  video: "Video",
  framepack: "FramePack",
  ltx: "LTX",
  "xyz-grid": "XYZ Grid",
};

function statusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "secondary";
    case "failed":
    case "cancelled":
      return "destructive";
    default:
      return "outline";
  }
}

function formatRelativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface HistoryJobCardProps {
  job: Job;
  onView?: (job: Job) => void;
  onRetry?: (job: Job) => void;
}

export function HistoryJobCard({ job, onView, onRetry }: HistoryJobCardProps) {
  const deleteJob = useDeleteJob();
  const TypeIcon = TYPE_ICONS[job.type] ?? Image;
  const hasImages = job.result && job.result.images.length > 0;
  const timestamp = job.completed_at ?? job.created_at;

  return (
    <div className="group flex items-start gap-2 px-3 py-1.5 hover:bg-muted/50 rounded">
      {/* Thumbnail or type icon */}
      {hasImages ? (
        <img
          src={job.result!.images[0].url}
          alt=""
          className="h-8 w-8 rounded-sm object-cover shrink-0"
        />
      ) : (
        <div className="h-8 w-8 rounded-sm bg-muted flex items-center justify-center shrink-0">
          <TypeIcon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-1.5 text-2xs">
          <TypeIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{TYPE_LABELS[job.type] ?? job.type}</span>
          <Badge
            variant={statusBadgeVariant(job.status)}
            className="text-4xs px-1 py-0 shrink-0"
          >
            {job.status}
          </Badge>
        </div>

        {job.status === "failed" && job.error && (
          <p className="text-4xs text-destructive truncate" title={job.error}>
            {job.error}
          </p>
        )}

        <p className="text-4xs text-muted-foreground font-mono tabular-nums">
          {formatRelativeTime(timestamp)}
        </p>
      </div>

      {/* Actions — visible on hover */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {hasImages && onView && (
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={() => onView(job)}
            title="View"
          >
            <Eye className="h-2.5 w-2.5" />
          </Button>
        )}
        {job.status === "failed" && onRetry && (
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={() => onRetry(job)}
            title="Retry"
          >
            <RotateCcw className="h-2.5 w-2.5" />
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5"
          onClick={() => deleteJob.mutate(job.id)}
          title="Delete"
        >
          <Trash2 className="h-2.5 w-2.5" />
        </Button>
      </div>
    </div>
  );
}
