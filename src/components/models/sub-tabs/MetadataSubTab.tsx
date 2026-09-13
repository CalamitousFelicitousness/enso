import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { useDeleteJob, useJob, useSubmitJob } from "@/api/hooks/useJobs";
import { Button } from "@/components/ui/button";
import type { CivitMetadataScanResult, CivitMetadataUpdateResult } from "@/api/types/modelOps";

function formatEta(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
}

export function MetadataSubTab() {
  const [jobId, setJobId] = useState<string | null>(null);
  const submit = useSubmitJob();
  const cancel = useDeleteJob();
  const { data: job } = useJob(jobId);

  const running = job?.status === "pending" || job?.status === "running";
  const busy = submit.isPending || running;

  const start = (mode: "scan" | "update") => {
    submit.mutate(
      { type: "metadata-sweep", mode },
      { onSuccess: (created) => setJobId(created.id) },
    );
  };

  const info = job?.status === "completed" ? (job.result?.info ?? null) : null;
  const mode = typeof info?.["mode"] === "string" ? info["mode"] : null;
  const rows = Array.isArray(info?.["results"]) ? info["results"] : [];

  // The worker records failures as "ExceptionName: message"; a busy sweep
  // arrives here rather than as an HTTP status because the job is queued.
  const error =
    job?.status === "failed"
      ? (job.error ?? "Sweep failed")
      : submit.error
        ? submit.error.message
        : null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Fetch model preview metadata from CivitAI.</p>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => start("scan")}
          disabled={busy}
          className="flex-1"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
          Scan missing
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => start("update")}
          disabled={busy}
          className="flex-1"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
          Update all
        </Button>
      </div>

      {running && job && (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-3xs text-muted-foreground">
            <span className="truncate">
              {job.steps > 0 ? `Hashing ${job.step} of ${job.steps}` : "Starting sweep…"}
            </span>
            <span className="flex items-center gap-1 shrink-0">
              {job.eta !== null && job.eta > 0 && (
                <span className="font-mono tabular-nums">{formatEta(job.eta)} left</span>
              )}
              <button
                type="button"
                onClick={() => cancel.mutate(job.id)}
                className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                aria-label="Cancel sweep"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-linear"
              style={{ width: `${Math.round((job.progress ?? 0) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <p className="text-2xs text-destructive border border-destructive/30 bg-destructive/10 rounded-md px-2 py-1">
          {error}
        </p>
      )}

      {job?.status === "cancelled" && (
        <p className="text-2xs text-muted-foreground">Sweep cancelled.</p>
      )}

      {mode === "scan" && rows.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium">Scan results ({rows.length})</p>
          <div className="border border-border rounded-md overflow-auto max-h-75">
            <table className="w-full text-2xs">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="px-2 py-1 text-left font-medium">Name</th>
                  <th className="px-2 py-1 text-left font-medium">Type</th>
                  <th className="px-2 py-1 text-left font-medium">Hash</th>
                  <th className="px-2 py-1 text-left font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {(rows as CivitMetadataScanResult[]).map((r, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="px-2 py-1 truncate max-w-30">{r.name}</td>
                    <td className="px-2 py-1">{r.type}</td>
                    <td className="px-2 py-1 font-mono">{r.hash || "-"}</td>
                    <td className="px-2 py-1 truncate max-w-25">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mode === "update" && rows.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium">Update results ({rows.length})</p>
          <div className="border border-border rounded-md overflow-auto max-h-75">
            <table className="w-full text-2xs">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="px-2 py-1 text-left font-medium">Name</th>
                  <th className="px-2 py-1 text-left font-medium">Versions</th>
                  <th className="px-2 py-1 text-left font-medium">Latest</th>
                  <th className="px-2 py-1 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {(rows as CivitMetadataUpdateResult[]).map((r, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="px-2 py-1 truncate max-w-30">{r.name ?? r.file}</td>
                    <td className="px-2 py-1">{r.versions ?? "-"}</td>
                    <td className="px-2 py-1 truncate max-w-20">{r.latest ?? "-"}</td>
                    <td className="px-2 py-1">{r.status ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {info !== null && rows.length === 0 && (
        <p className="text-2xs text-muted-foreground">No results.</p>
      )}
    </div>
  );
}
