import { memo, useCallback, useMemo } from "react";
import { Play, Square } from "lucide-react";
import { useUiStore } from "@/stores/uiStore";
import { useViewShortcut } from "@/hooks/useViewShortcut";
import { useRegisterCommand } from "@/lib/commandRegistry";
import { toast } from "sonner";
import { useVideoStore } from "@/stores/videoStore";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import {
  useJobQueueStore,
  selectVideoDomainRunning,
  selectVideoPendingCount,
} from "@/stores/jobStore";
import { useSubmitToQueue } from "@/hooks/useSubmitToQueue";
import { useActionProgress, useUploadView } from "@/hooks/useActionProgress";
import { unrecordedSubmission } from "@/inputs/jobs";
import type { UploadBatch } from "@/inputs/uploads";
import { useActiveVideoCaps } from "@/hooks/useActiveVideoCaps";
import { useVideoCanvasStore } from "@/stores/videoCanvasStore";
import { useVideoCapsDefaults } from "@/hooks/useVideoCapsDefaults";
import { sendToJob } from "@/hooks/useJobTracker";
import { useCancelJob } from "@/api/hooks/useJobs";
import { ACTIONS } from "@/lib/media/progress";
import {
  BEING_SENT,
  NOTHING_TO_STOP,
  SENDING,
  STOP_GENERATION,
  STOP_UPLOAD,
} from "@/lib/media/text";
import { buildCloudVideoRequest } from "@/lib/request/buildCloudVideo";
import { buildVideoPayload } from "@/lib/video/buildVideoPayload";
import { resolveVideoUi, kindToDomain } from "@/lib/videoModel";
import { Button } from "@/components/ui/button";
import { announceText, SubmitAnnouncer, SubmitLabel } from "@/components/ui/submit-label";
import { TabbedPanel } from "@/components/layout/TabbedPanel";
import { tabPanelEntries } from "@/components/layout/tabRegistry";
import { VIDEO_TAB_REGISTRY } from "./tabs/registry";
import { useVideoTabs } from "./tabs/useVideoTabs";
import { VideoPresetSelector } from "./VideoPresetSelector";
import { VideoResultStrip } from "./VideoResultStrip";
import { buildPanels } from "@/components/ui/tab-panels";

// Module scope: stable element references, see buildPanels. The footer needs
// the same treatment for a different reason - this panel re-renders on every
// progress tick, and a fresh element would re-render the strip with it.
const VIDEO_PANELS = buildPanels(tabPanelEntries(VIDEO_TAB_REGISTRY));
const VIDEO_FOOTER = <VideoResultStrip />;

const ACTION = ACTIONS.video;

/** The Generate button's icon and words: the upload, then the running video
 * job's task (a load reads "Load model") and percentage. It reads the stores
 * itself, so progress re-renders it alone. */
const GenerateLabel = memo(function GenerateLabel() {
  const upload = useUploadView(ACTION);
  const running = useJobQueueStore(selectVideoDomainRunning);
  const queued = useJobQueueStore(selectVideoPendingCount);
  return (
    <SubmitLabel
      upload={upload}
      job={running ? { task: running.task || null, progress: running.progress, queued } : null}
      running="Generating"
    >
      <Play size={14} />
      {`Generate${queued > 0 ? ` [${queued}]` : ""}`}
    </SubmitLabel>
  );
});

/** What a screen reader hears of the Generate button, beside it. */
const GenerateAnnouncer = memo(function GenerateAnnouncer() {
  const upload = useUploadView(ACTION);
  const running = useJobQueueStore(selectVideoDomainRunning);
  return <SubmitAnnouncer text={announceText(upload, !!running, "Generating")} />;
});

export function VideoPanel() {
  const prompt = useVideoStore((s) => s.prompt);
  const activeModel = useModelSelectionStore((s) => s.activeModel);
  const { activePanelId, job } = useVideoTabs();
  const kind = resolveVideoUi(activeModel);
  const domain = kindToDomain(kind);
  const activeCaps = useActiveVideoCaps();
  useVideoCapsDefaults();

  // the id alone, so a running job's progress does not re-render the panel
  const runningVideoJobId = useJobQueueStore((s) => selectVideoDomainRunning(s)?.id ?? null);
  const cancelJob = useCancelJob();

  // The job loads its model when it runs, under the server's queue lock, so
  // a click never replaces the model of a job running ahead of it
  const build = useCallback(
    (batch: UploadBatch) => {
      if (kind === "cloud") {
        return unrecordedSubmission(domain, buildCloudVideoRequest(batch), batch);
      }
      if (kind === "empty" || !activeModel || activeModel.source !== "local-video") {
        // Generate button is gated by canGenerate so this branch shouldn't
        // run in practice. Throwing a regular Error lets useSubmitToQueue
        // surface a real "Failed to submit" toast as a safety net.
        throw new Error("No video model selected");
      }
      return unrecordedSubmission(
        domain,
        buildVideoPayload(kind, activeModel, activeCaps, batch),
        batch,
      );
    },
    [kind, domain, activeModel, activeCaps],
  );

  const {
    submit,
    isSubmitting: submitting,
    cancel,
  } = useSubmitToQueue(useMemo(() => ({ build, action: ACTION }), [build]));
  const uploadPhase = useActionProgress(ACTION, (e) => e?.phase ?? null);
  const isSubmitting = submitting || uploadPhase !== null;

  // Stop acts on the upload first, then on the running job
  const handleStop = useCallback(() => {
    if (uploadPhase === "sending") {
      toast.info(BEING_SENT);
      return;
    }
    if (cancel()) return;
    if (runningVideoJobId) {
      sendToJob(runningVideoJobId, { type: "interrupt" });
      cancelJob.mutate(runningVideoJobId);
      return;
    }
    toast.info(NOTHING_TO_STOP);
  }, [uploadPhase, cancel, runningVideoJobId, cancelJob]);
  const uploading = uploadPhase !== null && uploadPhase !== "sending";
  const stopLabel =
    uploadPhase === "sending"
      ? SENDING
      : uploading
        ? STOP_UPLOAD
        : runningVideoJobId
          ? STOP_GENERATION
          : NOTHING_TO_STOP;
  const stopApplies = uploading || runningVideoJobId !== null;

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

  // Own the generate shortcut and palette entries while Video is the active
  // view. Distinct command ids: the registry is one entry per id, so sharing
  // "actions:generate" would let one panel's cleanup drop the other's.
  const isVideoView = useUiStore((s) => s.activeNavView === "video");
  useViewShortcut("video", "generate", () => {
    if (!isSubmitting && canGenerate) void submit();
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
        if (!isSubmitting && canGenerate) void submit();
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
      run: handleStop,
    },
    isVideoView,
  );

  return (
    <TabbedPanel
      panels={VIDEO_PANELS}
      activePanelId={activePanelId}
      headerClassName="px-3 py-2 space-y-2"
      footer={VIDEO_FOOTER}
      {...(kind === "empty"
        ? {
            emptyState: "Pick a video model from the model selector to configure and run it.",
          }
        : {})}
      header={
        <>
          {job && <VideoPresetSelector domain={job} />}
          {/* Generate and Stop keep their places in every state */}
          <div className="flex gap-2">
            {/* Title rides the wrapper: a disabled button swallows pointer
                events, so its own title never shows. */}
            <div
              className="flex-1 min-w-0"
              title={
                missingRefs
                  ? "This model conditions on references - add at least one reference or an init image"
                  : undefined
              }
            >
              <Button
                type="button"
                onClick={() => void submit()}
                disabled={isSubmitting || !canGenerate}
                variant="default"
                size="sm"
                className="w-full"
              >
                <GenerateLabel />
              </Button>
            </div>
            <Button
              type="button"
              onClick={handleStop}
              aria-disabled={stopApplies ? undefined : true}
              className={stopApplies ? undefined : "opacity-50"}
              variant="destructive"
              size="icon-sm"
              aria-label={stopLabel}
              title={uploadPhase === "sending" ? BEING_SENT : stopLabel}
            >
              <Square size={14} />
            </Button>
          </div>
          <GenerateAnnouncer />
        </>
      }
    />
  );
}
