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
import { keptInputs, type Submission } from "@/inputs/jobs";
import { applyFix } from "@/inputs/processing";
import { outlineOf } from "@/inputs/outlineOf";
import { useOutlineWithEnv } from "@/inputs/useOutline";
import { processorFacts } from "@/lib/processorUtils";
import { preprocessorsQuery } from "@/api/hooks/useControl";
import { detailProcessedText, fixLabel, problemText } from "@/lib/inputs/text";
import { buildControlRequest, InputRefusal, SettingRefusal } from "@/lib/request/buildGenerate";
import { buildCloudImageRequest } from "@/lib/request/buildCloudImage";
import { buildDetailRequest } from "@/lib/request/buildDetail";
import { restoreSettings, restoreSettingsAndInputs, resultTarget } from "@/lib/request/restore";
import { useRunAgain } from "@/hooks/useRunAgain";
import { useJobFact } from "@/inputs/jobs";
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
import { DEFAULT_SIZE_MULTIPLE, referenceSetsSize } from "@/lib/sizeCompute";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { useModelCapabilityStore, type ModelCapabilityRecord } from "@/stores/modelCapabilityStore";
import { usePromptHistoryStore } from "@/stores/promptHistoryStore";
import { useSubmitToQueue, UserAbortError } from "@/hooks/useSubmitToQueue";
import { sendToJob } from "@/hooks/useJobTracker";
import { useCancelJob } from "@/api/hooks/useJobs";
import { useLoadModel } from "@/api/hooks/useModels";
import { useModelCapabilities } from "@/hooks/useModelCapabilities";
import { api } from "@/api/client";
import type { CheckpointInfoV2, DetailerMode } from "@/api/types/models";
import type { ServerInfo } from "@/api/types/server";
import { useQueryClient } from "@tanstack/react-query";
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
import { ProgressRing } from "@/components/ui/progress-ring";
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
import { GenerationDiffDialog } from "@/components/generation/GenerationDiffDialog";

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
  const [diffOpen, setDiffOpen] = useState(false);
  const cancelJob = useCancelJob();
  const loadModel = useLoadModel();
  const queryClient = useQueryClient();

  const buildSubmission = useCallback(async (): Promise<Submission> => {
    const { activeModel } = useModelSelectionStore.getState();

    // Active model belongs to the Video panel - refuse to build an image
    // request from it. UserAbortError tells useSubmitToQueue to skip the
    // "Failed to submit job" toast since we already surfaced guidance.
    if (activeModel?.source === "local-video") {
      toast.warning("Switch to Video view to use this model");
      throw new UserAbortError("local-video model active on Images view");
    }

    // Selecting a local model only updates the store (manual-load semantics),
    // so the backend may still have a different checkpoint loaded. Load the
    // selected one before queueing or the job runs on the wrong model. Going
    // through the shared ["checkpoint"] query and load mutation refreshes the
    // dropdown's loaded-model label and dedupes a single load across the
    // batch/xyz paths, which call buildRequest once.
    let maxInputImages: number | null = null;
    let requestSetsSize: boolean | null = null;
    let sizeMultiple = DEFAULT_SIZE_MULTIPLE;
    let detailerMode: DetailerMode | null = null;
    let strengthSupported = true;
    let controlSeparateInit: boolean | null = null;
    let controlUnified: boolean | null = null;
    let checkpoint: Submission["checkpoint"] =
      activeModel?.source === "cloud"
        ? { title: `${activeModel.provider}/${activeModel.id}`, name: activeModel.name }
        : null;
    // The canvas sized a lone Reference from the model it knew before this load
    let referenceSets = activeModel?.source !== "cloud";
    if (activeModel?.source === "local") {
      const fetchCheckpoint = (staleTime: number) =>
        queryClient.fetchQuery({
          queryKey: ["checkpoint"],
          queryFn: () => api.get<CheckpointInfoV2>("/sdapi/v2/checkpoint"),
          staleTime,
        });
      let loaded = await fetchCheckpoint(30_000);
      const shown = loaded.loaded && loaded.title === activeModel.title;
      // For a pick not loaded yet, the canvas went by what the model reported when last loaded
      const remembered: ModelCapabilityRecord | undefined =
        useModelCapabilityStore.getState().byTitle[activeModel.title];
      referenceSets = referenceSetsSize(
        true,
        (shown ? loaded.request_sets_size : remembered?.request_sets_size) ?? null,
      );
      if (!loaded.loaded || loaded.title !== activeModel.title) {
        toast.info("Loading model", { description: activeModel.title });
        await loadModel.mutateAsync(activeModel.title);
        // The input limit and size multiple belong to the model just loaded
        loaded = await fetchCheckpoint(0);
      }
      checkpoint = { title: loaded.title ?? activeModel.title, name: activeModel.model_name };
      maxInputImages = loaded.max_input_images ?? null;
      requestSetsSize = loaded.request_sets_size ?? null;
      sizeMultiple = loaded.size_multiple ?? DEFAULT_SIZE_MULTIPLE;
      detailerMode = loaded.detailer_mode ?? null;
      strengthSupported = loaded.strength_applicable ?? true;
      controlUnified = loaded.control_unified ?? null;
      // Whether this sdnext leaves a control unit its own picture beside an Initial picture
      const info = await queryClient.fetchQuery({
        queryKey: ["server-info"],
        queryFn: () => api.get<ServerInfo>("/sdapi/v2/server-info"),
        staleTime: 30_000,
      });
      controlSeparateInit = info.capabilities?.control_separate_init ?? null;
    }

    // Record the prompt being generated into the prompt-history popover.
    const submitted = useGenerationStore.getState();
    usePromptHistoryStore.getState().addEntry({
      prompt: submitted.prompt,
      negative: submitted.negativePrompt,
      model: activeModel
        ? activeModel.source === "local"
          ? activeModel.model_name
          : activeModel.name
        : "",
      width: submitted.width,
      height: submitted.height,
      steps: submitted.steps,
    });

    // Every map key names the server's processors: the list is fetched, not
    // taken from a canvas that may not have it yet
    const processors = processorFacts(await queryClient.fetchQuery(preprocessorsQuery));

    if (activeModel?.source === "cloud") {
      const { request, inputs, ledger } = await buildCloudImageRequest(processors);
      clearSelection();
      return {
        domain: "generate",
        request,
        ledger,
        inputs: keptInputs(inputs),
        mapKeys: [],
        checkpoint,
      };
    }

    const gen = useGenerationStore.getState();
    if (gen.detailerEnabled && gen.detailerOnly) {
      const { request, inputs, ledger } = await buildDetailRequest();
      clearSelection();
      return {
        domain: "generate",
        request,
        ledger,
        inputs: keptInputs(inputs),
        mapKeys: [],
        checkpoint,
      };
    }

    const { request, mapKeys, inputs, ledger } = await buildControlRequest({
      maxInputImages,
      requestSetsSize,
      sizeMultiple,
      referenceSets,
      strengthSupported,
      detailerMode,
      controlSeparateInit,
      controlUnified,
      processors,
    }).catch((err: unknown) => {
      if (err instanceof InputRefusal) {
        toast.warning("Can't generate with these input images", { description: err.message });
        throw new UserAbortError(err.message);
      }
      if (err instanceof SettingRefusal) {
        toast.warning("Can't generate with these settings", { description: err.message });
        throw new UserAbortError(err.message);
      }
      throw err;
    });
    clearSelection();
    return {
      domain: "generate",
      request: { type: "generate", ...request },
      ledger,
      inputs: keptInputs(inputs),
      mapKeys,
      checkpoint,
    };
  }, [clearSelection, loadModel, queryClient]);

  const { submit, isSubmitting } = useSubmitToQueue(
    useMemo(() => ({ build: buildSubmission }), [buildSubmission]),
  );

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

  const lastFacts = useJobFact(lastResult?.jobId);
  const { runAgain } = useRunAgain();
  const restoreLast = useCallback(
    (inputs: boolean) => {
      if (!lastResult) {
        toast.info(NO_RESULT_YET);
        return;
      }
      const target = resultTarget(lastResult, 0);
      if (inputs) void restoreSettingsAndInputs(target);
      else restoreSettings(target);
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
    ).runAgain;
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
      if (e.shiftKey) setDiffOpen(true);
      else restoreLast(false);
    },
    [lastResult, restoreLast],
  );

  const progressPct = Math.round(progress * 100);
  const phase = runningJob?.domain === "generate" ? runningJob.task : "";
  const phaseLabel = phase || "Generating";

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
          {isGenerating ? (
            <ProgressRing progress={progress} size={14} strokeWidth={2} />
          ) : (
            <Play size={14} />
          )}
          {isGenerating
            ? `${phaseLabel}${progressPct > 0 ? ` ${progressPct}%` : ""}${pendingCount > 0 ? ` [+${pendingCount}]` : ""}`
            : detailerOnly
              ? `Detail${pendingCount > 0 ? ` [${pendingCount}]` : ""}`
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
            aria-label={RESTORE_LAST}
            aria-disabled={lastResult ? undefined : true}
            className={lastResult ? undefined : "opacity-50"}
            variant="secondary"
            size="icon-sm"
            title={lastResult ? RESTORE_LAST_TITLE : NO_RESULT_YET}
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
