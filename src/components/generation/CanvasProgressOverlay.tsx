import { useJobQueueStore, selectViewedJob } from "@/stores/jobStore";

export function CanvasProgressOverlay() {
  const job = useJobQueueStore(selectViewedJob);
  if (!job || job.status !== "running") return null;

  const pct = Math.round(job.progress * 100);
  const hasSteps = job.step > 0 && job.steps > 0;

  return (
    <div className="absolute inset-x-0 bottom-0 p-4 pointer-events-none">
      <div className="flex flex-col gap-1 bg-background/80 backdrop-blur-sm rounded-lg px-3 py-2 max-w-md mx-auto">
        {(job.stageCount > 1 || hasSteps || job.phase) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {job.stageCount > 1 && (
              <span className="font-medium">
                Stage {job.stage + 1}/{job.stageCount} · {job.stageName}
              </span>
            )}
            {hasSteps && (
              <span className="font-mono tabular-nums">
                Step {job.step}/{job.steps}
              </span>
            )}
            {job.phase && (
              <>
                <span className="text-muted-foreground/40">|</span>
                <span className="text-muted-foreground/50 truncate">{job.phase}</span>
              </>
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            {pct > 0 ? (
              <div
                className="h-full bg-primary rounded-full transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            ) : (
              <div className="h-full bg-primary rounded-full animate-[indeterminate_1.5s_ease-in-out_infinite] origin-left" />
            )}
          </div>
          <span className="text-xs text-muted-foreground font-mono tabular-nums min-w-[3ch]">
            {pct}%
          </span>
        </div>
      </div>
    </div>
  );
}
