import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Play, Square, Sparkles, Settings2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useVideoStore } from "@/stores/videoStore";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { usePromptEnhanceStore } from "@/stores/promptEnhanceStore";
import {
  useJobQueueStore,
  selectVideoActive,
  selectFramepackActive,
  selectLtxActive,
  selectDomainProgress,
  selectDomainRunning,
} from "@/stores/jobStore";
import { useSubmitToQueue } from "@/hooks/useSubmitToQueue";
import { sendToJob } from "@/hooks/useJobTracker";
import { useCancelJob } from "@/api/hooks/useJobs";
import { usePromptEnhance } from "@/api/hooks/usePromptEnhance";
import { useLoadVideoModel, useLoadFramePack } from "@/api/hooks/useVideo";
import { uploadFile, uploadBlob } from "@/lib/upload";
import { buildCloudVideoRequest } from "@/lib/requestBuilder";
import { resolveVideoUi, kindToDomain, type VideoUiKind } from "@/lib/videoModel";
import { Button } from "@/components/ui/button";
import { PromptField } from "@/components/generation/PromptField";
import { ScrollArea } from "@/components/ui/scroll-area";
import { KeepAlivePanel, KeepAliveSwitch } from "@/components/ui/keep-alive";
import { Label } from "@/components/ui/label";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { PromptEnhanceWorkspace } from "@/components/generation/PromptEnhanceWorkspace";
import { WanHunyuanForm } from "./forms/WanHunyuanForm";
import { FramePackForm } from "./forms/FramePackForm";
import { LtxForm } from "./forms/LtxForm";
import { CloudVideoForm } from "./forms/CloudVideoForm";
import type { LocalVideoModel } from "@/api/types/cloud";
import type { PromptEnhanceRequest } from "@/api/types/promptEnhance";

// One panel per video UI kind. The "empty" state has no params - render a
// hint inline rather than as a 5th keep-alive panel. Forms below are
// kept-alive across kind swaps so CodeMirror cursors, textarea drafts,
// FramePack section prompts, etc. survive the user switching models.
function subPanel(id: VideoUiKind, content: ReactNode) {
  return (
    <KeepAlivePanel key={id} id={id} activeClassName="flex-1 overflow-hidden">
      <ScrollArea className="size-full">
        <div className="p-3 min-w-0">{content}</div>
      </ScrollArea>
    </KeepAlivePanel>
  );
}

const SUB_PANELS = [
  subPanel("generic", <WanHunyuanForm />),
  subPanel("framepack", <FramePackForm />),
  subPanel("ltx", <LtxForm />),
  subPanel("cloud", <CloudVideoForm />),
];

async function buildLocalVideoPayload(kind: VideoUiKind, model: LocalVideoModel) {
  const s = useVideoStore.getState();
  const output = {
    fps: s.fps,
    interpolate: s.interpolate,
    codec: s.codec,
    format: s.format,
    codec_options: s.codecOptions,
    save_video: s.saveVideo,
    save_frames: s.saveFrames,
    save_safetensors: s.saveSafetensors,
  };

  const initRef = s.initImage ? await uploadFile(s.initImage) : null;
  const lastRef = s.lastImage ? await uploadFile(s.lastImage) : null;

  if (kind === "framepack") {
    return {
      type: "framepack" as const,
      prompt: s.prompt,
      negative: s.negative,
      seed: s.seed,
      variant: model.model,
      resolution: s.fpResolution,
      duration: s.fpDuration,
      latent_ws: s.fpLatentWindowSize,
      steps: s.fpSteps,
      shift: s.fpShift,
      cfg_scale: s.fpCfgScale,
      cfg_distilled: s.fpCfgDistilled,
      cfg_rescale: s.fpCfgRescale,
      start_weight: s.fpStartWeight,
      end_weight: s.fpEndWeight,
      vision_weight: s.fpVisionWeight,
      section_prompt: s.fpSectionPrompt,
      system_prompt: s.fpSystemPrompt,
      use_teacache: s.fpTeacache,
      optimized_prompt: s.fpOptimizedPrompt,
      use_cfgzero: s.fpCfgZero,
      use_preview: s.fpPreview,
      attention: s.fpAttention,
      vae_type: s.fpVaeType,
      init_image: initRef,
      end_image: lastRef,
      ...output,
    };
  }

  if (kind === "ltx") {
    return {
      type: "ltx" as const,
      model: model.model,
      prompt: s.prompt,
      negative: s.negative,
      seed: s.seed,
      width: s.width,
      height: s.height,
      frames: s.frames,
      steps: s.ltxSteps,
      decode_timestep: s.ltxDecodeTimestep,
      image_cond_noise_scale: s.ltxNoiseScale,
      upsample_enable: s.ltxUpsampleEnable,
      upsample_ratio: s.ltxUpsampleRatio,
      refine_enable: s.ltxRefineEnable,
      refine_strength: s.ltxRefineStrength,
      condition_strength: s.ltxConditionStrength,
      condition_image: initRef,
      condition_last: lastRef,
      audio_enable: s.ltxAudioEnable,
      ...output,
    };
  }

  // "generic" - Wan/Hunyuan/etc. routed through the canonical /video/load.
  return {
    type: "video" as const,
    engine: model.engine,
    model: model.model,
    prompt: s.prompt,
    negative: s.negative,
    seed: s.seed,
    width: s.width,
    height: s.height,
    frames: s.frames,
    steps: s.steps,
    guidance_scale: s.guidanceScale,
    guidance_true: s.guidanceTrue,
    sampler_shift: s.samplerShift,
    dynamic_shift: s.dynamicShift,
    init_strength: s.initStrength,
    init_image: initRef,
    last_image: lastRef,
    vae_type: s.vaeType,
    vae_tile_frames: s.vaeTileFrames,
    ...output,
  };
}

export function VideoPanel() {
  const prompt = useVideoStore((s) => s.prompt);
  const negative = useVideoStore((s) => s.negative);
  const setParam = useVideoStore((s) => s.setParam);
  const activeModel = useModelSelectionStore((s) => s.activeModel);
  const kind = resolveVideoUi(activeModel);
  const domain = kindToDomain(kind);

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
  const [enhanceOpen, setEnhanceOpen] = useState(false);
  const enhanceStore = usePromptEnhanceStore();
  const pinned = usePromptEnhanceStore((s) => s.pinned);
  const setPendingResult = usePromptEnhanceStore((s) => s.setPendingResult);
  const enhanceMutation = usePromptEnhance();

  const handleEnhance = useCallback(async () => {
    if (!prompt.trim()) {
      toast.warning("Enter a prompt first");
      return;
    }
    let image: string | null = null;
    if (enhanceStore.useVision) {
      const initImg = useVideoStore.getState().initImage;
      if (initImg) image = await uploadBlob(initImg, "vision.png");
    }
    const req: PromptEnhanceRequest = {
      prompt,
      type: "video",
      model: enhanceStore.model || null,
      system_prompt: enhanceStore.systemPrompt || null,
      prefix: enhanceStore.prefix || null,
      suffix: enhanceStore.suffix || null,
      nsfw: enhanceStore.nsfw,
      seed: enhanceStore.seed,
      do_sample: enhanceStore.doSample,
      max_tokens: enhanceStore.maxTokens,
      temperature: enhanceStore.temperature,
      repetition_penalty: enhanceStore.repetitionPenalty,
      top_k: enhanceStore.topK || null,
      top_p: enhanceStore.topP || null,
      thinking: enhanceStore.thinking,
      keep_thinking: enhanceStore.keepThinking,
      use_vision: enhanceStore.useVision,
      prefill: enhanceStore.prefill || null,
      keep_prefill: enhanceStore.keepPrefill,
      image,
    };
    enhanceMutation.mutate(req, {
      onSuccess: (res) => {
        setPendingResult({
          prompt: res.prompt,
          seed: res.seed,
          originalPrompt: prompt,
        });
        setEnhanceOpen(true);
        toast.success(`Prompt enhanced (seed: ${res.seed})`);
      },
      onError: (err) => {
        toast.error(`Enhance failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      },
    });
  }, [prompt, enhanceStore, enhanceMutation, setPendingResult]);

  const handleAcceptEnhanced = useCallback((p: string) => setParam("prompt", p), [setParam]);

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
    const payload = await buildLocalVideoPayload(kind, activeModel);
    return { payload, snapshot: { kind: "none" as const } };
  }, [kind, activeModel]);

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

  const canGenerate = kind !== "empty" && !!prompt.trim();
  const progressPct = Math.round(progress * 100);

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Sticky header: prompt + Generate stay visible while the
          kind-specific form scrolls independently below. */}
      <div className="shrink-0 p-3 pb-0 space-y-1 border-b border-border">
        <div className="space-y-1.5 mb-3">
          <div className="flex items-center justify-between mb-1">
            <Label className="text-2xs text-muted-foreground">Prompt</Label>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => void handleEnhance()}
                disabled={enhanceMutation.isPending}
                className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                title="Enhance prompt"
              >
                {enhanceMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
              </button>
              <Popover open={enhanceOpen} onOpenChange={setEnhanceOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    title="Enhance settings"
                  >
                    <Settings2 size={13} />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="right"
                  align="start"
                  className="w-96 p-0"
                  onInteractOutside={(e) => {
                    if (pinned) e.preventDefault();
                  }}
                  onEscapeKeyDown={(e) => {
                    if (pinned) e.preventDefault();
                  }}
                >
                  <ScrollArea className="max-h-[80vh]">
                    <PromptEnhanceWorkspace
                      onEnhance={() => void handleEnhance()}
                      isPending={enhanceMutation.isPending}
                      onClose={() => setEnhanceOpen(false)}
                      onAccept={handleAcceptEnhanced}
                      onSelectPrompt={handleAcceptEnhanced}
                    />
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <PromptField
            value={prompt}
            onChange={(v) => setParam("prompt", v)}
            placeholder="Describe the video..."
            className="min-h-15"
          />

          <PromptField
            value={negative}
            onChange={(v) => setParam("negative", v)}
            placeholder="Negative prompt (optional)"
            className="min-h-9"
          />
        </div>

        <div className="space-y-2 mb-3">
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={isSubmitting || isLoadingModel || !canGenerate}
              variant="default"
              size="sm"
              className="flex-1"
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
        </div>
      </div>

      {kind === "empty" ? (
        <div className="p-6 text-center text-3xs text-muted-foreground">
          Pick a video model from the model selector to configure and run it.
        </div>
      ) : (
        <KeepAliveSwitch active={kind}>{SUB_PANELS}</KeepAliveSwitch>
      )}
    </div>
  );
}
