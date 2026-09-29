import { useCallback, useMemo } from "react";
import { Play, Square, SkipForward, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCancelJob } from "@/api/hooks/useJobs";
import { usePostprocessScripts } from "@/api/hooks/usePostprocess";
import { useProcessStore, type ProcessSectionKey } from "@/stores/processStore";
import {
  useJobQueueStore,
  selectProcessActive,
  selectProcessProgress,
  selectProcessRunning,
} from "@/stores/jobStore";
import { useUiStore } from "@/stores/uiStore";
import { useSubmitToQueue, UserAbortError } from "@/hooks/useSubmitToQueue";
import { sendToJob } from "@/hooks/useJobTracker";
import { useRegisterCommand } from "@/lib/commandRegistry";
import { uploadFile, uploadFiles } from "@/lib/upload";
import {
  activeSections,
  buildProcessPayload,
  type ProcessInputs,
  type ProcessSettings,
} from "@/lib/processRequest";
import type { ProcessMode } from "@/api/types/v2";
import type { PostprocessScript } from "@/api/types/process";
import { Button } from "@/components/ui/button";
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

const UPLOAD_CHUNK = 20;

async function uploadAll(files: File[]): Promise<string[]> {
  const refs: string[] = [];
  for (let i = 0; i < files.length; i += UPLOAD_CHUNK) {
    refs.push(...(await uploadFiles(files.slice(i, i + UPLOAD_CHUNK))));
  }
  return refs;
}

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
  const progress = useJobQueueStore(selectProcessProgress);
  const running = useJobQueueStore(selectProcessRunning);
  const cancelJob = useCancelJob();
  const isProcessView = useUiStore((s) => s.activeNavView === "process");

  const { data: scriptList } = usePostprocessScripts();
  const order = useMemo(() => {
    const known: ProcessSectionKey[] = (scriptList?.scripts ?? [])
      .map((s: PostprocessScript) => (s.field ? FIELD_KEYS[s.field] : undefined))
      .filter((k: ProcessSectionKey | undefined): k is ProcessSectionKey => k !== undefined);
    return [...known, ...FALLBACK_ORDER.filter((k) => !known.includes(k))];
  }, [scriptList]);

  const buildRequest = useCallback(async () => {
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
    let inputs: ProcessInputs = {};
    if (s.mode === "image") {
      const file = s.files[0] ?? refuse("Add an image first");
      inputs = { images: [await uploadFile(file)] };
    } else if (s.mode === "batch") {
      if (s.files.length === 0) refuse("Add images first");
      inputs = { images: await uploadAll(s.files) };
    } else if (s.mode === "folder") {
      if (!settings.inputDir) refuse("Enter a folder on the server to read");
    } else {
      const video = s.videoFile ?? refuse("Add a video first");
      inputs = { video: await uploadFile(video) };
    }
    s.clearResults();
    return { payload: buildProcessPayload(settings, inputs), snapshot: { kind: "none" as const } };
  }, []);

  const { submit, isSubmitting } = useSubmitToQueue(
    useMemo(() => ({ domain: "process" as const, buildRequest }), [buildRequest]),
  );

  const handleStop = useCallback(() => {
    if (!running) return;
    sendToJob(running.id, { type: "interrupt" });
    cancelJob.mutate(running.id);
  }, [running, cancelJob]);

  const handleSkip = useCallback(() => {
    if (running) sendToJob(running.id, { type: "skip" });
  }, [running]);

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

  const progressPct = Math.round(progress * 100);

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
        <div className="flex gap-2">
          <Button
            type="button"
            data-param="process"
            onClick={() => void submit()}
            disabled={isSubmitting || isActive || !hasInput}
            size="sm"
            className="flex-1"
          >
            {isActive ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Play size={14} />
                Process
              </>
            )}
          </Button>
          {running && (
            <Button
              type="button"
              onClick={handleSkip}
              variant="secondary"
              size="icon-sm"
              title="Skip current image"
            >
              <SkipForward size={14} />
            </Button>
          )}
          {isActive && (
            <Button
              type="button"
              onClick={handleStop}
              variant="destructive"
              size="icon-sm"
              title="Stop processing"
            >
              <Square size={14} />
            </Button>
          )}
        </div>
        {isActive && progressPct > 0 && (
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
