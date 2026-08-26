import { useCallback, useMemo, useState } from "react";
import { Play, Square, Loader2 } from "lucide-react";
import { useUiStore } from "@/stores/uiStore";
import { useViewShortcut } from "@/hooks/useViewShortcut";
import { useRegisterCommand } from "@/lib/commandRegistry";
import { toast } from "sonner";
import { useVideoStore } from "@/stores/videoStore";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import {
  useJobQueueStore,
  selectVideoActive,
  selectFramepackActive,
  selectLtxActive,
  selectDomainProgress,
  selectDomainRunning,
} from "@/stores/jobStore";
import { useSubmitToQueue } from "@/hooks/useSubmitToQueue";
import { useActiveVideoCaps } from "@/hooks/useActiveVideoCaps";
import { useVideoCanvasStore } from "@/stores/videoCanvasStore";
import { useVideoCapsDefaults } from "@/hooks/useVideoCapsDefaults";
import { sendToJob } from "@/hooks/useJobTracker";
import { useCancelJob } from "@/api/hooks/useJobs";
import { useLoadVideoModel, useLoadFramePack } from "@/api/hooks/useVideo";
import { buildCloudVideoRequest } from "@/lib/requestBuilder";
import { buildVideoPayload } from "@/lib/video/buildVideoPayload";
import { resolveVideoUi, kindToDomain } from "@/lib/videoModel";
import { Button } from "@/components/ui/button";
import { TabbedPanel } from "@/components/layout/TabbedPanel";
import { tabPanelEntries } from "@/components/layout/tabRegistry";
import { VIDEO_TAB_REGISTRY } from "./tabs/registry";
import { useVideoTabs } from "./tabs/useVideoTabs";
import { VideoPresetSelector } from "./VideoPresetSelector";
import { buildPanels } from "@/components/ui/tab-panels";

// Two panels: every local engine renders through the caps-driven
// CapabilityForm (per-engine drafts live in videoStore, so nothing worth
// preserving is lost by sharing one tree), cloud keeps its own form. The
// "empty" state renders a hint inline rather than as a third panel.
// Module scope: stable element references, see buildPanels.
const VIDEO_PANELS = buildPanels(tabPanelEntries(VIDEO_TAB_REGISTRY));

export function VideoPanel() {
  const prompt = useVideoStore((s) => s.prompt);
  const activeModel = useModelSelectionStore((s) => s.activeModel);
  const { activePanelId, job } = useVideoTabs();
  const kind = resolveVideoUi(activeModel);
  const domain = kindToDomain(kind);
  const activeCaps = useActiveVideoCaps();
  useVideoCapsDefaults();

  const isVideoActive = useJobQueueStore(selectVideoActive);
  const isFramepackActive = useJobQueueStore(selectFramepackActive);
  const isLtxActive = useJobQueueStore(selectLtxActive);
  const isGenerating = isVideoActive || isFramepackActive || isLtxActive;
  const selectProgress = useMemo(() => selectDomainProgress(domain), [domain]);
  const selectRunning = useMemo(() => selectDomainRunning(domain), [domain]);
  const progress = useJobQueueStore(selectProgress);
  const runningVideoJob = useJobQueueStore(selectRunning);

  const cancelJob = useCancelJob();

  // Pre-submit load mutations - only used when generating with a local-video
  // model. The unified action-row Load button writes the same mutations; this
  // path lets us lazy-load when the user clicks Generate without an explicit
  // Load click first (the "load on generate" semantic).
  const loadVideoModel = useLoadVideoModel();
  const loadFramePack = useLoadFramePack();
  const [isLoadingModel, setIsLoadingModel] = useState(false);

  // Prompt enhance

  const buildRequest = useCallback(async () => {
    if (kind === "cloud") {
      const payload = await buildCloudVideoRequest();
      return { payload, snapshot: { kind: "none" as const } };
    }
    if (kind === "empty" || !activeModel || activeModel.source !== "local-video") {
      // Generate button is gated by canGenerate so this branch shouldn't
      // run in practice. Throwing a regular Error lets useSubmitToQueue
      // surface a real "Failed to submit" toast as a safety net.
      throw new Error("No video model selected");
    }
    const payload = await buildVideoPayload(kind, activeModel, activeCaps);
    return { payload, snapshot: { kind: "none" as const } };
  }, [kind, activeModel, activeCaps]);

  const { submit, isSubmitting } = useSubmitToQueue(
    useMemo(() => ({ domain, buildRequest }), [domain, buildRequest]),
  );

  // "Load on generate": when the active model is local video, ensure it's
  // loaded before submission. Server is idempotent (re-firing load when the
  // model is already loaded is cheap), so we don't try to be clever about
  // skipping when activeModel.loaded is already true - that snapshot can be
  // stale, and the cost of being wrong is a redundant 50-200ms round-trip
  // rather than a real generation failure.
  const handleGenerate = useCallback(async () => {
    if (kind === "generic" || kind === "ltx" || kind === "framepack") {
      if (!activeModel || activeModel.source !== "local-video") return;
      setIsLoadingModel(true);
      try {
        if (kind === "framepack") {
          const attention = useVideoStore.getState().fpAttention;
          await loadFramePack.mutateAsync({ variant: activeModel.model, attention });
        } else {
          await loadVideoModel.mutateAsync({
            engine: activeModel.engine,
            model: activeModel.model,
          });
        }
      } catch (err) {
        toast.error("Failed to load model", {
          description: err instanceof Error ? err.message : String(err),
        });
        return;
      } finally {
        setIsLoadingModel(false);
      }
    }
    void submit();
  }, [kind, activeModel, loadVideoModel, loadFramePack, submit]);

  const handleCancel = useCallback(() => {
    if (runningVideoJob) {
      sendToJob(runningVideoJob.id, { type: "interrupt" });
      cancelJob.mutate(runningVideoJob.id);
    }
  }, [runningVideoJob, cancelJob]);

  // Reference workflows condition on media: the server takes the init image
  // as reference 1 when the list is empty, so either satisfies the gate -
  // but only when the payload actually carries init (a stale hidden init
  // frame on an init-ignoring model never reaches the wire).
  const referenceCount = useVideoCanvasStore((s) => s.references.length);
  const hasInitFrame = useVideoCanvasStore((s) => s.initFrame !== null);
  const initCounts = activeCaps.init_image !== "ignored" && hasInitFrame;
  const missingRefs =
    kind === "generic" && activeCaps.references.required && referenceCount === 0 && !initCounts;

  const canGenerate = kind !== "empty" && !!prompt.trim() && !missingRefs;
  const progressPct = Math.round(progress * 100);

  // Own the generate shortcut and palette entries while Video is the active
  // view. Distinct command ids: the registry is one entry per id, so sharing
  // "actions:generate" would let one panel's cleanup drop the other's.
  const isVideoView = useUiStore((s) => s.activeNavView === "video");
  useViewShortcut("video", "generate", () => {
    if (!isSubmitting && !isLoadingModel && canGenerate) void handleGenerate();
  });
  useRegisterCommand(
    {
      id: "video:generate",
      label: "Generate video",
      group: "Actions",
      keywords: ["run", "render", "clip"],
      icon: Play,
      shortcutId: "generate",
      run: () => {
        if (!isSubmitting && !isLoadingModel && canGenerate) void handleGenerate();
      },
    },
    isVideoView,
  );
  useRegisterCommand(
    {
      id: "video:interrupt",
      label: "Interrupt video generation",
      group: "Actions",
      keywords: ["stop", "cancel", "abort"],
      icon: Square,
      run: handleCancel,
    },
    isVideoView,
  );

  return (
    <TabbedPanel
      panels={VIDEO_PANELS}
      activePanelId={activePanelId}
      headerClassName="px-3 py-2 space-y-2"
      {...(kind === "empty"
        ? {
            emptyState: "Pick a video model from the model selector to configure and run it.",
          }
        : {})}
      header={
        <>
          {job && <VideoPresetSelector domain={job} />}
          <div className="flex gap-2">
            {/* Title rides the wrapper: a disabled button swallows pointer
                events, so its own title never shows. */}
            <div
              className="flex-1"
              title={
                missingRefs
                  ? "This model conditions on references - add at least one reference or an init image"
                  : undefined
              }
            >
              <Button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={isSubmitting || isLoadingModel || !canGenerate}
                variant="default"
                size="sm"
                className="w-full"
              >
                {isLoadingModel ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Loading model...
                  </>
                ) : (
                  <>
                    <Play size={14} />
                    Generate
                  </>
                )}
              </Button>
            </div>
            {isGenerating && (
              <Button type="button" onClick={handleCancel} variant="destructive" size="sm">
                <Square size={14} />
                Stop
              </Button>
            )}
          </div>
          {isGenerating && progressPct > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-[width] duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground font-mono tabular-nums">
                {progressPct}%
              </span>
            </div>
          )}
        </>
      }
    />
  );
}
