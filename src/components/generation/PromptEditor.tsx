import { useGenerationStore } from "@/stores/generationStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { usePromptEnhanceStore } from "@/stores/promptEnhanceStore";
import { usePromptEnhance } from "@/api/hooks/usePromptEnhance";
import { flattenCanvas } from "@/lib/flattenCanvas";
import { uploadBlob } from "@/lib/upload";
import { useState, useCallback } from "react";
import { PromptField } from "./PromptField";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDown,
  ChevronRight,
  Sparkles,
  Loader2,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { PromptEnhanceWorkspace } from "./PromptEnhanceWorkspace";
import type { PromptEnhanceRequest } from "@/api/types/promptEnhance";

export function PromptEditor() {
  const prompt = useGenerationStore((s) => s.prompt);
  const negativePrompt = useGenerationStore((s) => s.negativePrompt);
  const setParam = useGenerationStore((s) => s.setParam);
  const [showNegative, setShowNegative] = useState(false);
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
    let image: string | undefined;
    if (enhanceStore.useVision) {
      const { width, height } = useGenerationStore.getState();
      const layers = useCanvasStore.getState().getImageLayers();
      const blob = await flattenCanvas(layers, width, height);
      if (blob) image = await uploadBlob(blob, "vision.png");
    }
    const req: PromptEnhanceRequest = {
      prompt,
      type: "text",
      model: enhanceStore.model || undefined,
      system_prompt: enhanceStore.systemPrompt || undefined,
      prefix: enhanceStore.prefix || undefined,
      suffix: enhanceStore.suffix || undefined,
      nsfw: enhanceStore.nsfw,
      seed: enhanceStore.seed,
      do_sample: enhanceStore.doSample,
      max_tokens: enhanceStore.maxTokens,
      temperature: enhanceStore.temperature,
      repetition_penalty: enhanceStore.repetitionPenalty,
      top_k: enhanceStore.topK || undefined,
      top_p: enhanceStore.topP || undefined,
      thinking: enhanceStore.thinking,
      keep_thinking: enhanceStore.keepThinking,
      use_vision: enhanceStore.useVision,
      prefill: enhanceStore.prefill || undefined,
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
        toast.error(
          `Enhance failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      },
    });
  }, [prompt, enhanceStore, enhanceMutation, setPendingResult]);

  return (
    <div className="flex flex-col gap-2">
      {/* Positive prompt */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-2xs text-muted-foreground">Prompt</Label>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={handleEnhance}
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
                    onEnhance={handleEnhance}
                    isPending={enhanceMutation.isPending}
                    onClose={() => setEnhanceOpen(false)}
                  />
                </ScrollArea>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <div data-tour="prompt-editor">
          <PromptField
            value={prompt}
            onChange={(v) => setParam("prompt", v)}
            placeholder="Describe what you want to generate..."
            className="min-h-20"
          />
        </div>
      </div>

      {/* Negative prompt */}
      <Collapsible open={showNegative} onOpenChange={setShowNegative}>
        <CollapsibleTrigger className="flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground transition-colors">
          {showNegative ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )}
          Negative prompt
        </CollapsibleTrigger>
        <CollapsibleContent>
          <PromptField
            value={negativePrompt}
            onChange={(v) => setParam("negativePrompt", v)}
            placeholder="What to avoid..."
            className="min-h-[3.125rem] mt-1.5"
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
