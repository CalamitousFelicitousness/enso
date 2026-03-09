import { useCallback, useState } from "react";
import { Play, Loader2, Eye, Aperture, Tags, Settings } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useCaptionStore } from "@/stores/captionStore";
import { useCaptionSettingsStore } from "@/stores/captionSettingsStore";
import {
  useOptionsSubset,
  useSetOptions,
} from "@/api/hooks/useSettings";
import {
  useOpenClipCaption,
  useTaggerCaption,
  useVqaCaption,
} from "@/api/hooks/useCaption";
import { uploadFile } from "@/lib/upload";
import { CUSTOM_PROMPT_TASKS } from "@/lib/captionModels";
import { VlmSettings } from "./methods/VlmSettings";
import { OpenClipSettings } from "./methods/OpenClipSettings";
import { TaggerSettings } from "./methods/TaggerSettings";
import type { CaptionMethod } from "@/api/types/caption";

type CaptionDefaultType = "VLM" | "OpenCLiP" | "Tagger";

type CaptionTab = CaptionMethod | "default";

const CAPTION_TAB_OPTIONS: { value: CaptionTab; label: string; icon: typeof Eye }[] = [
  { value: "vlm", label: "VLM", icon: Eye },
  { value: "openclip", label: "OpenCLiP", icon: Aperture },
  { value: "tagger", label: "Tagger", icon: Tags },
  { value: "default", label: "Default", icon: Settings },
];

const CAPTION_DEFAULT_OPTIONS: { value: CaptionDefaultType; label: string }[] = [
  { value: "VLM", label: "VLM" },
  { value: "OpenCLiP", label: "OpenCLiP" },
  { value: "Tagger", label: "Tagger" },
];

export function CaptionPanel() {
  const image = useCaptionStore((s) => s.image);
  const isProcessing = useCaptionStore((s) => s.isProcessing);
  const method = useCaptionStore((s) => s.method);
  const setResult = useCaptionStore((s) => s.setResult);
  const setProcessing = useCaptionStore((s) => s.setProcessing);
  const setMethod = useCaptionStore((s) => s.setMethod);

  const [activeTab, setActiveTab] = useState<CaptionMethod | "default">(method);
  const { data: captionOpts } = useOptionsSubset(["caption_default_type"]);
  const setOptions = useSetOptions();
  const defaultType = (captionOpts?.caption_default_type as CaptionDefaultType) ?? "VLM";

  const handleTabChange = useCallback(
    (v: CaptionMethod | "default") => {
      setActiveTab(v);
      if (v !== "default") setMethod(v);
    },
    [setMethod],
  );

  const handleDefaultTypeChange = useCallback(
    (v: CaptionDefaultType) => {
      setOptions.mutate({ caption_default_type: v });
    },
    [setOptions],
  );

  const openclipMut = useOpenClipCaption();
  const taggerMut = useTaggerCaption();
  const vqaMut = useVqaCaption();

  const handleCaption = useCallback(async () => {
    if (!image || isProcessing) return;
    setProcessing(true);
    setResult(null);
    try {
      const ref = await uploadFile(image);
      const settings = useCaptionSettingsStore.getState();

      if (method === "vlm") {
        const s = settings.vlm;
        const res = await vqaMut.mutateAsync({
          image: ref,
          model: s.model,
          question: s.task,
          prompt: CUSTOM_PROMPT_TASKS.includes(s.task)
            ? s.customPrompt
            : undefined,
          system: s.system,
          include_annotated: true,
          max_tokens: s.maxTokens,
          temperature: s.temperature,
          top_k: s.topK,
          top_p: s.topP,
          num_beams: s.numBeams,
          do_sample: s.doSample,
          thinking_mode: s.thinkingMode,
          prefill: s.prefill || undefined,
          keep_thinking: s.keepThinking,
          keep_prefill: s.keepPrefill,
        });
        setResult({ ...res, type: "vqa" });
      } else if (method === "openclip") {
        const s = settings.openclip;
        const res = await openclipMut.mutateAsync({
          image: ref,
          clip_model: s.clipModel,
          blip_model: s.blipModel,
          mode: s.mode,
          analyze: s.analyze,
          max_length: s.maxLength,
          chunk_size: s.chunkSize,
          min_flavors: s.minFlavors,
          max_flavors: s.maxFlavors,
          flavor_count: s.flavorCount,
          num_beams: s.numBeams,
        });
        setResult({ ...res, type: "openclip" });
      } else {
        const s = settings.tagger;
        const res = await taggerMut.mutateAsync({
          image: ref,
          model: s.model,
          threshold: s.threshold,
          character_threshold: s.characterThreshold,
          max_tags: s.maxTags,
          include_rating: s.includeRating,
          sort_alpha: s.sortAlpha,
          use_spaces: s.useSpaces,
          escape_brackets: s.escapeBrackets,
          exclude_tags: s.excludeTags,
          show_scores: s.showScores,
        });
        setResult({ ...res, type: "tagger" });
      }
    } catch (err) {
      toast.error("Captioning failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setProcessing(false);
    }
  }, [
    image,
    isProcessing,
    method,
    vqaMut,
    openclipMut,
    taggerMut,
    setProcessing,
    setResult,
  ]);

  return (
    <div className="flex flex-col h-full">
      {/* Caption button */}
      <div className="px-3 py-2 border-b border-border">
        <Button
          onClick={handleCaption}
          disabled={!image || isProcessing}
          size="sm"
          className="w-full"
        >
          {isProcessing ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Captioning...
            </>
          ) : (
            <>
              <Play size={14} />
              Caption
            </>
          )}
        </Button>
      </div>

      {/* Method tabs + settings */}
      <ScrollArea className="flex-1">
        <div className="p-3">
          <SegmentedControl
            options={CAPTION_TAB_OPTIONS}
            value={activeTab}
            onValueChange={handleTabChange}
            variant="stacked"
            animated
            className="w-full"
          />

          <div className="mt-3">
            {activeTab === "vlm" && <VlmSettings />}
            {activeTab === "openclip" && <OpenClipSettings />}
            {activeTab === "tagger" && <TaggerSettings />}
            {activeTab === "default" && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                    Default Caption Type
                  </span>
                  <p className="text-3xs text-muted-foreground leading-tight">
                    Caption method used for quick interrogate actions
                  </p>
                </div>
                <SegmentedControl
                  options={CAPTION_DEFAULT_OPTIONS}
                  value={defaultType}
                  onValueChange={handleDefaultTypeChange}
                  animated
                />
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
