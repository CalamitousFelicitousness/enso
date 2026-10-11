import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Play, Square, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { useDeleteJob } from "@/api/hooks/useJobs";
import { usePostprocessScripts } from "@/api/hooks/usePostprocess";
import { useProcessStore, type ProcessSectionKey } from "@/stores/processStore";
import { useJobQueueStore, selectProcessActive, selectProcessRunning } from "@/stores/jobStore";
import { useUiStore } from "@/stores/uiStore";
import { useSubmitToQueue } from "@/hooks/useSubmitToQueue";
import { useActionProgress, useUploadView } from "@/hooks/useActionProgress";
import { UserAbortError } from "@/lib/abort";
import type { RetryOffer } from "@/inputs/action";
import { unrecordedSubmission } from "@/inputs/jobs";
import { stageLutOn } from "@/inputs/luts";
import type { UploadBatch } from "@/inputs/uploads";
import { sendToJob } from "@/hooks/useJobTracker";
import { useRegisterCommand } from "@/lib/commandRegistry";
import { ACTIONS } from "@/lib/media/progress";
import type { UploadRefused } from "@/lib/media/refused";
import {
  batchText,
  BEING_SENT,
  NO_IMAGE_TO_SKIP,
  NOTHING_TO_STOP,
  processOthersText,
  SENDING,
  STOP_PROCESSING,
  STOP_UPLOAD,
} from "@/lib/media/text";
import {
  activeSections,
  buildProcessPayload,
  type ProcessInputs,
  type ProcessSettings,
} from "@/lib/processRequest";
import type { ProcessMode } from "@/api/types/v2";
import type { PostprocessScript } from "@/api/types/process";
import { Button } from "@/components/ui/button";
import { announceText, SubmitAnnouncer, SubmitLabel } from "@/components/ui/submit-label";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TextToggle } from "@/components/ui/text-toggle";
import { CheckRow } from "./sections/ProcessSection";
import { UpscaleSection } from "./sections/UpscaleSection";
import { DetailerSection } from "./sections/DetailerSection";
import { GradingSection } from "./sections/GradingSection";
import { RembgSection } from "./sections/RembgSection";
import { NudenetSection } from "./sections/NudenetSection";
import { SeedvrSection } from "./sections/SeedvrSection";
import { PixelartSection } from "./sections/PixelartSection";
import { DlssSection } from "./sections/DlssSection";
import { CreateVideoSection } from "./sections/CreateVideoSection";

const MODES: { value: ProcessMode; label: string }[] = [
  { value: "image", label: "Image" },
  { value: "batch", label: "Batch" },
  { value: "folder", label: "Folder" },
  { value: "video", label: "Video" },
];

const SECTIONS: Record<ProcessSectionKey, () => React.ReactElement> = {
  upscale: UpscaleSection,
  detailer: DetailerSection,
  grading: GradingSection,
  rembg: RembgSection,
  nudenet: NudenetSection,
  seedvr: SeedvrSection,
  pixelart: PixelartSection,
  dlss: DlssSection,
  createVideo: CreateVideoSection,
};

// wire field of ProcessParams -> store section
const FIELD_KEYS: Record<string, ProcessSectionKey> = {
  upscale: "upscale",
  detailer: "detailer",
  grading: "grading",
  rembg: "rembg",
  nudenet: "nudenet",
  seedvr: "seedvr",
  pixelart: "pixelart",
  dlss: "dlss",
  create_video: "createVideo",
};

// sdnext's default run order, until the server reports its own
const FALLBACK_ORDER: ProcessSectionKey[] = [
  "detailer",
  "upscale",
  "grading",
  "rembg",
  "nudenet",
  "seedvr",
  "pixelart",
  "dlss",
  "createVideo",
];

const ACTION = ACTIONS.process;

/** What the view shows goes once the server has taken the job that replaces it. */
const clearShownResults = () => useProcessStore.getState().clearResults();

/** The Process button's icon and words: the upload, then the running job's
 * percentage. It reads the stores itself, so progress re-renders it alone. */
const ProcessLabel = memo(function ProcessLabel() {
  const upload = useUploadView(ACTION);
  const running = useJobQueueStore(selectProcessRunning);
  return (
    <SubmitLabel
      upload={upload}
      job={running ? { task: null, progress: running.progress, queued: 0 } : null}
      running="Processing"
    >
      <Play size={14} />
      Process
    </SubmitLabel>
  );
});

/** The line under the row, kept so the sections below never move. While an
 * upload runs it is the upload's, as the button is: its files and bytes once
 * its percentage shows. Otherwise the running job's task. */
const ProcessCounts = memo(function ProcessCounts() {
  const entry = useActionProgress(ACTION, (e) => e);
  const running = useJobQueueStore(selectProcessRunning);
  const counts = entry?.shown && (entry.phase === "uploading" || entry.phase === "storing");
  const text = entry
    ? counts
      ? batchText(entry.done, entry.files, entry.sent, entry.total)
      : ""
    : (running?.task ?? "");
  return <p className="h-4 truncate text-3xs text-muted-foreground tabular-nums">{text}</p>;
});

/** What a screen reader hears of the Process button, beside it. */
const ProcessAnnouncer = memo(function ProcessAnnouncer() {
  const upload = useUploadView(ACTION);
  const running = useJobQueueStore(selectProcessRunning);
  return <SubmitAnnouncer text={announceText(upload, !!running, "Processing")} />;
});

export function ProcessPanel() {
  const mode = useProcessStore((s) => s.mode);
  const setMode = useProcessStore((s) => s.setMode);
  const saveOutput = useProcessStore((s) => s.saveOutput);
  const setSaveOutput = useProcessStore((s) => s.setSaveOutput);
  const inputDir = useProcessStore((s) => s.inputDir);
  const outputDir = useProcessStore((s) => s.outputDir);
  const showResults = useProcessStore((s) => s.showResults);
  const setInputDir = useProcessStore((s) => s.setInputDir);
  const setOutputDir = useProcessStore((s) => s.setOutputDir);
  const setShowResults = useProcessStore((s) => s.setShowResults);
  const hasInput = useProcessStore((s) =>
    s.mode === "video"
      ? !!s.videoFile
      : s.mode === "folder"
        ? !!s.inputDir.trim()
        : s.files.length > 0,
  );

  const isActive = useJobQueueStore(selectProcessActive);
  // the id alone, so a running job's progress does not re-render the panel
  const runningId = useJobQueueStore((s) => selectProcessRunning(s)?.id ?? null);
  const cancelJob = useDeleteJob();
  const isProcessView = useUiStore((s) => s.activeNavView === "process");

  const { data: scriptList } = usePostprocessScripts();
  const order = useMemo(() => {
    const known: ProcessSectionKey[] = (scriptList?.scripts ?? [])
      .map((s: PostprocessScript) => (s.field ? FIELD_KEYS[s.field] : undefined))
      .filter((k: ProcessSectionKey | undefined): k is ProcessSectionKey => k !== undefined);
    return [...known, ...FALLBACK_ORDER.filter((k) => !known.includes(k))];
  }, [scriptList]);

  // The files each staged ref sent, for the refusal of the ones that can no longer be read
  const stagedFiles = useRef(new Map<string, File>());

  const build = useCallback((batch: UploadBatch) => {
    const s = useProcessStore.getState();
    const settings: ProcessSettings = {
      mode: s.mode,
      sections: s.sections,
      saveOutput: s.saveOutput,
      inputDir: s.inputDir.trim(),
      outputDir: s.outputDir.trim(),
      showResults: s.showResults,
    };
    const refuse = (message: string): never => {
      toast.warning(message);
      throw new UserAbortError(message);
    };
    if (activeSections(settings).length === 0) {
      refuse(
        s.mode === "video"
          ? "Enable SeedVR or DLSS to process a video"
          : "Enable at least one section",
      );
    }
    const staged = new Map<string, File>();
    const stage = (file: File) => {
      const { ref } = batch.stage(file, { name: file.name });
      staged.set(ref, file);
      return ref;
    };
    let inputs: ProcessInputs = {};
    if (s.mode === "image") {
      const file = s.files[0] ?? refuse("Add an image first");
      inputs = { images: [stage(file)] };
    } else if (s.mode === "batch") {
      // files a run could not read stay out until they are added again
      const files = s.files.filter((f) => !s.unreadable.has(f));
      if (files.length === 0) refuse("Add images first");
      inputs = { images: files.map(stage) };
    } else if (s.mode === "folder") {
      if (!settings.inputDir) refuse("Enter a folder on the server to read");
    } else {
      const video = s.videoFile ?? refuse("Add a video first");
      inputs = { video: stage(video) };
    }
    const lut = activeSections(settings).includes("grading") ? stageLutOn(batch, "process") : null;
    stagedFiles.current = staged;
    return unrecordedSubmission("process", buildProcessPayload(settings, inputs, lut), batch);
  }, []);

  // A batch run with files it can no longer read marks them and offers the rest
  const submitLatest = useRef<() => Promise<void>>(() => Promise.resolve());
  const refused = useCallback((err: UploadRefused): RetryOffer | null => {
    if (err.failure.kind !== "unreadable" || !err.failure.refs) return null;
    const lost = err.failure.refs.flatMap((ref) => {
      const file = stagedFiles.current.get(ref);
      return file ? [file] : [];
    });
    const store = useProcessStore.getState();
    store.markUnreadable(lost);
    const others = stagedFiles.current.size - lost.length;
    if (store.mode !== "batch" || lost.length === 0 || others === 0) return null;
    return {
      label: processOthersText(others),
      run: () => void submitLatest.current(),
      cancel: true,
    };
  }, []);

  const {
    submit,
    isSubmitting: submitting,
    cancel,
  } = useSubmitToQueue(
    useMemo(
      () => ({ build, action: ACTION, refused, onPosted: clearShownResults }),
      [build, refused],
    ),
  );
  useEffect(() => {
    submitLatest.current = submit;
  }, [submit]);
  const uploadPhase = useActionProgress(ACTION, (e) => e?.phase ?? null);
  const isSubmitting = submitting || uploadPhase !== null;

  // Stop acts on the upload first, then on the running job
  const handleStop = useCallback(() => {
    if (uploadPhase === "sending") {
      toast.info(BEING_SENT);
      return;
    }
    if (cancel()) return;
    if (runningId) {
      sendToJob(runningId, { type: "interrupt" });
      cancelJob.mutate(runningId);
      return;
    }
    toast.info(NOTHING_TO_STOP);
  }, [uploadPhase, cancel, runningId, cancelJob]);
  const uploading = uploadPhase !== null && uploadPhase !== "sending";
  const stopLabel =
    uploadPhase === "sending"
      ? SENDING
      : uploading
        ? STOP_UPLOAD
        : runningId
          ? STOP_PROCESSING
          : NOTHING_TO_STOP;
  const stopApplies = uploading || runningId !== null;

  const handleSkip = useCallback(() => {
    if (runningId) sendToJob(runningId, { type: "skip" });
    else toast.info(NO_IMAGE_TO_SKIP);
  }, [runningId]);

  useRegisterCommand(
    {
      id: "process:run",
      label: "Process",
      group: "Actions",
      keywords: ["run", "postprocess", "upscale"],
      icon: Play,
      shortcutId: "generate",
      run: () => {
        if (!isSubmitting && !isActive && hasInput) void submit();
      },
    },
    isProcessView,
  );
  useRegisterCommand(
    {
      id: "process:interrupt",
      label: "Stop processing",
      group: "Actions",
      keywords: ["stop", "cancel", "abort"],
      icon: Square,
      run: handleStop,
    },
    isProcessView,
  );

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border space-y-2">
        <SegmentedControl options={MODES} value={mode} onValueChange={setMode} animated />
        {mode === "folder" && (
          <div className="space-y-1.5">
            <Input
              value={inputDir}
              onChange={(e) => setInputDir(e.target.value)}
              placeholder="Folder on the server to read"
              className="h-6 text-2xs px-2"
            />
            <Input
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
              placeholder="Folder to write, empty for the default"
              className="h-6 text-2xs px-2"
            />
            <CheckRow
              label="Show result images"
              checked={showResults}
              onCheckedChange={setShowResults}
              title="Return the processed images here as well as writing them"
            />
          </div>
        )}
        {/* Process, Skip and Stop keep their places in every state */}
        <div className="flex gap-2">
          <Button
            type="button"
            data-param="process"
            onClick={() => void submit()}
            disabled={isSubmitting || isActive || !hasInput}
            size="sm"
            className="flex-1 min-w-0"
          >
            <ProcessLabel />
          </Button>
          <Button
            type="button"
            onClick={handleSkip}
            aria-disabled={runningId ? undefined : true}
            className={runningId ? undefined : "opacity-50"}
            variant="secondary"
            size="icon-sm"
            aria-label={runningId ? "Skip current image" : NO_IMAGE_TO_SKIP}
            title={runningId ? "Skip current image" : NO_IMAGE_TO_SKIP}
          >
            <SkipForward size={14} />
          </Button>
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
        <ProcessCounts />
        <ProcessAnnouncer />
        <TextToggle
          label="Save output"
          checked={saveOutput}
          onCheckedChange={setSaveOutput}
          disabled={mode === "folder"}
        />
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-3 pt-2 pb-3 space-y-1">
          {order.map((key) => {
            const Section = SECTIONS[key];
            return <Section key={key} />;
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
