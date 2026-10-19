import { useGenerationStore } from "@/stores/generationStore";
import {
  useJobQueueStore,
  selectRunningJob,
  selectGenerateActive,
  selectPendingCount,
} from "@/stores/jobStore";
import { useInputStore } from "@/stores/inputStore";
import { activeProcessor, isPlaced } from "@/lib/inputs/types";
import { firstInitialEntry } from "@/lib/inputs/outline";
import { buildImagesSubmission } from "@/inputs/buildImages";
import type { UploadBatch } from "@/inputs/uploads";
import { useActionProgress, useUploadView } from "@/hooks/useActionProgress";
import { ACTIONS } from "@/lib/media/progress";
import { applyFix } from "@/inputs/processing";
import { outlineOf } from "@/inputs/outlineOf";
import { useOutlineWithEnv } from "@/inputs/useOutline";
import { detailProcessedText, fixLabel, problemText } from "@/lib/inputs/text";
import { restoreFrom, resultTarget } from "@/lib/request/restore";
import { useRunAgain } from "@/hooks/useRunAgain";
import { useJobFact } from "@/hooks/useJobFact";
import { BEING_SENT, NO_SKIP, SENDING, STOP_GENERATION, STOP_UPLOAD } from "@/lib/media/text";
import { hasLegacyInputs } from "@/inputs/legacyResult";
import { resultActions } from "@/lib/jobs/cardActions";
import {
  LAST_NOT_REPLAYABLE,
  NO_RESULT_YET,
  reasonText,
  RESTORE_LAST,
  RESTORE_LAST_BOTH,
  RESTORE_LAST_TITLE,
  RUN_LAST_AGAIN,
} from "@/lib/jobs/text";
import { usePromptHistoryStore } from "@/stores/promptHistoryStore";
import { useSubmitToQueue } from "@/hooks/useSubmitToQueue";
import { sendToJob } from "@/hooks/useJobTracker";
import { useDeleteJob } from "@/api/hooks/useJobs";
import { useLoadModel } from "@/api/hooks/useModels";
import { useModelCapabilities } from "@/hooks/useModelCapabilities";
import {
  ArchiveRestore,
  ChevronDown,
  Grid3X3,
  History,
  Layers,
  Play,
  Repeat2,
  SkipForward,
  Square,
} from "lucide-react";
import { announceText, SubmitAnnouncer, SubmitLabel } from "@/components/ui/submit-label";
import { useState, useCallback, useMemo, memo } from "react";
import { toast } from "sonner";
import { useUiStore } from "@/stores/uiStore";
import { useViewShortcut } from "@/hooks/useViewShortcut";
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
import { useRestoreDialogStore } from "@/stores/restoreDialogStore";

const IMAGES_ACTION = ACTIONS.images;

/** The Generate button's icon and words. It reads the stores itself, so an
 * upload's events re-render it and nothing else. */
const GenerateLabel = memo(function GenerateLabel({
  verb,
  pendingCount,
}: {
  verb: string;
  pendingCount: number;
}) {
  const upload = useUploadView(IMAGES_ACTION);
  const isActive = useJobQueueStore(selectGenerateActive);
  const runningJob = useJobQueueStore(selectRunningJob);
  const job = runningJob?.domain === "generate" ? runningJob : null;
  return (
    <SubmitLabel
      upload={upload}
      job={
        isActive
          ? { task: job?.task ?? null, progress: job?.progress ?? 0, queued: pendingCount }
          : null
      }
      running="Generating"
    >
      <Play size={14} />
      {`${verb}${pendingCount > 0 ? ` [${pendingCount}]` : ""}`}
    </SubmitLabel>
  );
});

/** What a screen reader hears of the Generate button, beside it. */
const GenerateAnnouncer = memo(function GenerateAnnouncer() {
  const upload = useUploadView(IMAGES_ACTION);
  const isActive = useJobQueueStore(selectGenerateActive);
  return <SubmitAnnouncer text={announceText(upload, isActive, "Generating")} />;
});

export const ActionBar = memo(function ActionBar() {
  const clearSelection = useGenerationStore((s) => s.clearSelection);
  const lastResult = useGenerationStore((s) => s.results[0]);
  const detailerEnabled = useGenerationStore((s) => s.detailerEnabled);
  const detailerOnly = useGenerationStore((s) => s.detailerOnly);
  const detailerModelCount = useGenerationStore((s) => s.detailerModels.length);
  const hasInputImage = useInputStore((s) =>
    s.frames.some((f) => f.role === "initial" && f.pictures.some(isPlaced)),
  );
  // Where Detail only would take its picture from, when a processor replaces it
  const processedDetailSource = useInputStore((s) => {
    const first = firstInitialEntry(outlineOf(s.frames));
    const frame = first && s.frames.find((f) => f.id === first.frameId);
    return first && frame && activeProcessor(frame) ? first.position : null;
  });

  const isActive = useJobQueueStore(selectGenerateActive);
  const runningJob = useJobQueueStore(selectRunningJob);
  const pendingCount = useJobQueueStore(selectPendingCount);
  const { outline, env } = useOutlineWithEnv();
  const problems = outline.problems;
  const setImagesSubTab = useUiStore((s) => s.setImagesSubTab);

  const detailerUnavailable = useModelCapabilities().detailerMode === "none";
  const detailOnlyBlockReason = useMemo(() => {
    if (!detailerOnly) return null;
    if (!detailerEnabled) return "Enable detailer first";
    if (detailerUnavailable) return "The loaded model cannot run the detailer";
    if (!hasInputImage) return "Detail only requires an image on the canvas";
    if (processedDetailSource !== null) return detailProcessedText(processedDetailSource);
    if (detailerModelCount === 0) return "Select at least one detailer model";
    return null;
  }, [
    detailerEnabled,
    detailerOnly,
    detailerUnavailable,
    hasInputImage,
    processedDetailSource,
    detailerModelCount,
  ]);

  const [batchOpen, setBatchOpen] = useState(false);
  const [xyzOpen, setXyzOpen] = useState(false);
  const openRestore = useRestoreDialogStore((s) => s.openResult);
  const cancelJob = useDeleteJob();
  const loadModel = useLoadModel();

  const buildSubmission = useCallback(
    (batch: UploadBatch) =>
      buildImagesSubmission(batch, {
        loadModel: (title) => loadModel.mutateAsync(title),
        recordPrompt: (draft) => usePromptHistoryStore.getState().addEntry(draft),
        clearSelection,
      }),
    [clearSelection, loadModel],
  );

  const {
    submit,
    isSubmitting: submitting,
    cancel,
  } = useSubmitToQueue(
    useMemo(() => ({ build: buildSubmission, action: IMAGES_ACTION }), [buildSubmission]),
  );
  // the run's phase alone, whichever of Generate, Batch or XYZ started it: its
  // percentage re-renders only the label
  const uploadPhase = useActionProgress(IMAGES_ACTION, (e) => e?.phase ?? null);
  const isSubmitting = submitting || uploadPhase !== null;

  // Generate stays clickable while the inputs block it: it says what, offers
  // the fix, and opens the Input tab
  const generate = useCallback(() => {
    if (isSubmitting || detailOnlyBlockReason) return;
    const problem = problems[0];
    if (problem) {
      toast.warning("Can't generate with these inputs", {
        description: problemText(problem),
        action: { label: fixLabel(problem), onClick: () => applyFix(env, problem) },
      });
      setImagesSubTab("input");
      return;
    }
    void submit();
  }, [isSubmitting, detailOnlyBlockReason, problems, env, setImagesSubTab, submit]);

  const isGenerating = isActive || isSubmitting;
  const runningGenJob = useJobQueueStore(selectGenerateActive);

  // Stop acts on an upload first, then on the running job
  const handleInterrupt = useCallback(() => {
    if (uploadPhase === "sending") {
      toast.info(BEING_SENT);
      return;
    }
    if (cancel()) return;
    if (runningJob && runningJob.domain === "generate") {
      sendToJob(runningJob.id, { type: "interrupt" });
      cancelJob.mutate(runningJob.id);
    }
  }, [uploadPhase, cancel, runningJob, cancelJob]);

  const handleSkip = useCallback(() => {
    if (runningJob && runningJob.domain === "generate") {
      sendToJob(runningJob.id, { type: "skip" });
    }
  }, [runningJob]);

  const lastFacts = useJobFact(lastResult?.jobId);
  const { runAgain } = useRunAgain();
  const restoreLast = useCallback(
    (inputs: boolean) => {
      if (!lastResult) {
        toast.info(NO_RESULT_YET);
        return;
      }
      void restoreFrom(resultTarget(lastResult, 0), inputs ? "both" : "settings");
    },
    [lastResult],
  );
  const runLastAgain = useCallback(() => {
    if (!lastResult) {
      toast.info(NO_RESULT_YET);
      return;
    }
    const reason = resultActions(
      {
        jobId: lastResult.jobId ?? null,
        type: lastResult.type ?? null,
        legacyInputs: hasLegacyInputs(lastResult),
      },
      lastFacts,
    ).runAgain.reason;
    if (reason || !lastResult.jobId) {
      toast.info(LAST_NOT_REPLAYABLE, {
        description: reasonText(reason ?? "olderResult"),
      });
      return;
    }
    void runAgain(lastResult.jobId);
  }, [lastResult, lastFacts, runAgain]);

  const handleHistoryClick = useCallback(
    (e: React.MouseEvent) => {
      if (!lastResult) {
        toast.info(NO_RESULT_YET);
        return;
      }
      if (e.shiftKey) openRestore(lastResult.id, 0);
      else restoreLast(false);
    },
    [lastResult, openRestore, restoreLast],
  );

  // Scoped to the Images view: this panel stays mounted under KeepAlive after
  // the user switches away, so an unscoped registration would answer for Video.
  const isImagesView = useUiStore((s) => s.activeNavView === "images");
  useViewShortcut("images", "generate", generate);
  useViewShortcut("images", "skip", handleSkip);

  // Command Palette entries - captured at mount, dispatched via current closure refs
  useRegisterCommand(
    {
      id: "actions:generate",
      label: "Generate",
      group: "Actions",
      keywords: ["run", "create", "start"],
      icon: Play,
      shortcutId: "generate",
      run: generate,
    },
    isImagesView,
  );
  useRegisterCommand(
    {
      id: "actions:interrupt",
      label: "Interrupt generation",
      group: "Actions",
      keywords: ["stop", "cancel", "abort"],
      icon: Square,
      run: handleInterrupt,
    },
    isImagesView,
  );
  useRegisterCommand(
    {
      id: "actions:skip",
      label: "Skip current step",
      group: "Actions",
      keywords: ["next", "advance"],
      icon: SkipForward,
      shortcutId: "skip",
      run: handleSkip,
    },
    isImagesView,
  );
  useRegisterCommand({
    id: "actions:restore-last",
    label: RESTORE_LAST,
    group: "Actions",
    keywords: ["previous", "history", "seed"],
    icon: History,
    run: () => restoreLast(false),
  });
  useRegisterCommand({
    id: "actions:restore-last-inputs",
    label: RESTORE_LAST_BOTH,
    group: "Actions",
    keywords: ["previous", "history", "inputs", "frames", "pictures"],
    icon: ArchiveRestore,
    run: () => restoreLast(true),
  });
  useRegisterCommand({
    id: "actions:run-last-again",
    label: RUN_LAST_AGAIN,
    group: "Actions",
    keywords: ["repeat", "retry", "resubmit", "again", "duplicate"],
    icon: Repeat2,
    run: runLastAgain,
  });
  useRegisterCommand({
    id: "actions:compare-last",
    label: "Compare with last generation",
    group: "Actions",
    keywords: ["diff", "compare", "history", "params"],
    icon: History,
    run: () => {
      if (lastResult) openRestore(lastResult.id, 0);
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
      <div
        className="flex flex-1 min-w-0"
        data-tour="generate-button"
        title={detailOnlyBlockReason ?? undefined}
      >
        <Button
          type="button"
          data-param="generate"
          onClick={generate}
          disabled={isSubmitting || !!detailOnlyBlockReason}
          variant="default"
          size="sm"
          className="flex-1 rounded-r-none"
        >
          <GenerateLabel verb={detailerOnly ? "Detail" : "Generate"} pendingCount={pendingCount} />
        </Button>
        {/* Stays in its slot while a job runs, so the row keeps its shape */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={isGenerating}
              aria-label="More ways to generate"
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
      </div>
      <GenerateAnnouncer />
      {/* Fixed width: the count appears without moving the buttons beside it */}
      <span
        className="grid w-4 shrink-0 place-items-center font-mono text-2xs tabular-nums text-amber-400"
        title={problems[0] ? problemText(problems[0]) : undefined}
        aria-label={
          problems.length > 0
            ? `${problems.length} input problem${problems.length === 1 ? "" : "s"}`
            : undefined
        }
      >
        {problems.length > 0 ? problems.length : ""}
      </span>
      <BatchDialog open={batchOpen} onOpenChange={setBatchOpen} build={buildSubmission} />

      {xyzOpen && (
        <XyzGridDialog open={xyzOpen} onOpenChange={setXyzOpen} build={buildSubmission} />
      )}

      {/* Stop: the upload while one runs, then the job; while the job is sent, which cannot be taken back, it says so */}
      {isGenerating && (
        <Button
          type="button"
          data-param="stop"
          onClick={handleInterrupt}
          aria-disabled={uploadPhase === "sending" ? true : undefined}
          className={uploadPhase === "sending" ? "opacity-50" : undefined}
          variant="destructive"
          size="icon-sm"
          aria-label={
            uploadPhase === "sending" ? SENDING : uploadPhase ? STOP_UPLOAD : STOP_GENERATION
          }
          title={
            uploadPhase === "sending" ? BEING_SENT : uploadPhase ? STOP_UPLOAD : STOP_GENERATION
          }
        >
          <Square size={14} />
        </Button>
      )}

      {/* Restore last settings */}
      {!isGenerating && (
        <Button
          type="button"
          data-param="restore"
          onClick={handleHistoryClick}
          aria-label={RESTORE_LAST}
          aria-disabled={lastResult ? undefined : true}
          className={lastResult ? undefined : "opacity-50"}
          variant="secondary"
          size="icon-sm"
          title={lastResult ? RESTORE_LAST_TITLE : NO_RESULT_YET}
        >
          <History size={14} />
        </Button>
      )}

      {/* Skip: always in its slot, unavailable while no generation runs */}
      <Button
        type="button"
        data-param="skip"
        onClick={handleSkip}
        aria-disabled={runningGenJob ? undefined : true}
        className={runningGenJob ? undefined : "opacity-50"}
        variant="secondary"
        size="icon-sm"
        aria-label="Skip current"
        title={runningGenJob ? "Skip current" : NO_SKIP}
      >
        <SkipForward size={14} />
      </Button>
    </div>
  );
});
