import { useGenerationStore } from "@/stores/generationStore";
import {
  useJobQueueStore,
  selectRunningJob,
  selectGenerateActive,
  selectPendingCount,
} from "@/stores/jobStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { useImg2ImgStore } from "@/stores/img2imgStore";
import { buildControlRequest, buildCloudImageRequest, restoreFromResult } from "@/lib/requestBuilder";
import { blobToBase64 } from "@/lib/image";
import { snapshotUnits } from "@/stores/controlStore";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { useSubmitToQueue } from "@/hooks/useSubmitToQueue";
import { sendToJob } from "@/hooks/useJobTracker";
import { useCancelJob } from "@/api/hooks/useJobs";
import {
  Play,
  Square,
  SkipForward,
  History,
  ChevronDown,
  Layers,
  Grid3X3,
} from "lucide-react";
import { ProgressRing } from "@/components/ui/progress-ring";
import { useState, useCallback, useMemo, memo } from "react";
import { toast } from "sonner";
import { useShortcut } from "@/hooks/useShortcut";
import { useRegisterCommand } from "@/lib/commandRegistry";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BatchDialog } from "@/components/generation/BatchDialog";
import { XyzGridDialog } from "@/components/generation/XyzGridDialog";
import { GenerationDiffDialog } from "@/components/generation/GenerationDiffDialog";

export const ActionBar = memo(function ActionBar() {
  const clearSelection = useGenerationStore((s) => s.clearSelection);
  const lastResult = useGenerationStore((s) => s.results[0]);

  const isActive = useJobQueueStore(selectGenerateActive);
  const runningJob = useJobQueueStore(selectRunningJob);
  const pendingCount = useJobQueueStore(selectPendingCount);

  const [batchOpen, setBatchOpen] = useState(false);
  const [xyzOpen, setXyzOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const cancelJob = useCancelJob();

  const buildRequest = useCallback(async () => {
    const { isCloud } = useModelSelectionStore.getState();

    if (isCloud) {
      const cloudRequest = await buildCloudImageRequest();
      clearSelection();
      return {
        payload: cloudRequest,
        snapshot: { controlUnits: [] },
      };
    }

    const isImg2Img = useCanvasStore.getState().layers.length > 0;
    const { request, inputBlob } = await buildControlRequest();
    const inputImage =
      isImg2Img && inputBlob ? await blobToBase64(inputBlob) : undefined;
    const maskLines = useImg2ImgStore.getState().maskLines;
    const inputMask =
      isImg2Img && maskLines.length > 0 ? maskLines.slice() : undefined;
    const controlUnits = await snapshotUnits();
    clearSelection();
    return {
      payload: { type: "generate" as const, ...request },
      snapshot: { inputImage, inputMask, controlUnits },
    };
  }, [clearSelection]);

  const { submit, isSubmitting } = useSubmitToQueue(
    useMemo(
      () => ({ domain: "generate" as const, buildRequest }),
      [buildRequest],
    ),
  );

  const isGenerating = isActive || isSubmitting;
  const runningGenJob = useJobQueueStore(selectGenerateActive);
  const progress = runningJob?.domain === "generate" ? runningJob.progress : 0;

  const handleInterrupt = useCallback(() => {
    if (runningJob && runningJob.domain === "generate") {
      sendToJob(runningJob.id, { type: "interrupt" });
      cancelJob.mutate(runningJob.id);
    }
  }, [runningJob, cancelJob]);

  const handleSkip = useCallback(() => {
    if (runningJob && runningJob.domain === "generate") {
      sendToJob(runningJob.id, { type: "skip" });
    }
  }, [runningJob]);

  const handleHistoryClick = useCallback(
    (e: React.MouseEvent) => {
      if (!lastResult) return;
      if (e.shiftKey) {
        setDiffOpen(true);
      } else {
        restoreFromResult(lastResult);
        toast.success("Settings restored from last generation");
      }
    },
    [lastResult],
  );

  const progressPct = Math.round(progress * 100);
  const phase = runningJob?.domain === "generate" ? runningJob.task : "";
  const phaseLabel = phase || "Generating";

  // Global keyboard shortcuts for generation
  useShortcut("generate", () => {
    if (!isSubmitting) submit();
  });
  useShortcut("skip", handleSkip);

  // Command Palette entries — captured at mount, dispatched via current closure refs
  useRegisterCommand({
    id: "actions:generate",
    label: "Generate",
    group: "Actions",
    keywords: ["run", "create", "start"],
    icon: Play,
    shortcutId: "generate",
    run: () => {
      if (!isSubmitting) submit();
    },
  });
  useRegisterCommand({
    id: "actions:interrupt",
    label: "Interrupt generation",
    group: "Actions",
    keywords: ["stop", "cancel", "abort"],
    icon: Square,
    run: handleInterrupt,
  });
  useRegisterCommand({
    id: "actions:skip",
    label: "Skip current step",
    group: "Actions",
    keywords: ["next", "advance"],
    icon: SkipForward,
    shortcutId: "skip",
    run: handleSkip,
  });
  useRegisterCommand({
    id: "actions:restore-last",
    label: "Restore last settings",
    group: "Actions",
    keywords: ["undo", "previous", "history"],
    icon: History,
    run: () => {
      if (!lastResult) return;
      restoreFromResult(lastResult);
      toast.success("Settings restored from last generation");
    },
  });
  useRegisterCommand({
    id: "actions:compare-last",
    label: "Compare with last generation",
    group: "Actions",
    keywords: ["diff", "compare", "history", "params"],
    icon: History,
    run: () => {
      if (!lastResult) return;
      setDiffOpen(true);
    },
  });
  useRegisterCommand({
    id: "actions:batch-generation",
    label: "Open Batch Generation",
    group: "Actions",
    keywords: ["batch", "queue", "multiple", "loop"],
    icon: Layers,
    run: () => setBatchOpen(true),
  });
  useRegisterCommand({
    id: "actions:xyz-grid",
    label: "Open XYZ Grid",
    group: "Actions",
    keywords: ["xyz", "grid", "matrix", "comparison", "sweep"],
    icon: Grid3X3,
    run: () => setXyzOpen(true),
  });

  return (
    <div className="flex items-center gap-2">
      {/* Generate button group */}
      <div className="flex flex-1 min-w-0" data-tour="generate-button">
        <Button
          type="button"
          data-param="generate"
          onClick={submit}
          disabled={isSubmitting}
          variant="default"
          size="sm"
          className="flex-1 rounded-r-none"
        >
          {isGenerating ? (
            <ProgressRing progress={progress} size={14} strokeWidth={2} />
          ) : (
            <Play size={14} />
          )}
          {isGenerating
            ? `${phaseLabel}${progressPct > 0 ? ` ${progressPct}%` : ""}${pendingCount > 0 ? ` [+${pendingCount}]` : ""}`
            : `Generate${pendingCount > 0 ? ` [${pendingCount}]` : ""}`}
        </Button>
        {!isGenerating && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="default"
                size="sm"
                className="px-1.5 rounded-l-none border-l border-primary-foreground/20"
              >
                <ChevronDown size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setBatchOpen(true)}>
                <Layers size={14} /> Batch Generation
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setXyzOpen(true)}>
                <Grid3X3 size={14} /> XYZ Grid
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <BatchDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        buildRequest={buildRequest}
      />

      {xyzOpen && (
        <XyzGridDialog
          open={xyzOpen}
          onOpenChange={setXyzOpen}
          buildRequest={buildRequest}
        />
      )}

      {/* Stop button */}
      {isGenerating && (
        <Button
          type="button"
          data-param="stop"
          onClick={handleInterrupt}
          variant="destructive"
          size="icon-sm"
          title="Stop generation"
        >
          <Square size={14} />
        </Button>
      )}

      {/* Restore last settings */}
      {!isGenerating && (
        <>
          <Button
            type="button"
            data-param="restore"
            onClick={handleHistoryClick}
            disabled={!lastResult}
            variant="secondary"
            size="icon-sm"
            title="Restore settings (Shift+click to compare)"
          >
            <History size={14} />
          </Button>
          <GenerationDiffDialog
            open={diffOpen}
            onOpenChange={setDiffOpen}
            result={lastResult ?? null}
          />
        </>
      )}

      {/* Skip button */}
      {runningGenJob && (
        <Button
          type="button"
          data-param="skip"
          onClick={handleSkip}
          variant="secondary"
          size="icon-sm"
          title="Skip current"
        >
          <SkipForward size={14} />
        </Button>
      )}
    </div>
  );
});
