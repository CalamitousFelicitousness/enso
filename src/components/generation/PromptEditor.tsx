import { useGenerationStore } from "@/stores/generationStore";
import { useCanvasStore } from "@/stores/canvasStore";
import type { ImageLayer } from "@/stores/canvasStore";
import { usePromptEnhanceStore } from "@/stores/promptEnhanceStore";
import { usePromptEnhance } from "@/api/hooks/usePromptEnhance";
import { flattenCanvas } from "@/lib/flattenCanvas";
import { uploadBlob } from "@/lib/upload";
import { useState, useCallback } from "react";
import { useUiStore } from "@/stores/uiStore";
import { PromptField } from "./PromptField";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { KeepAlivePanel } from "@/components/ui/keep-alive";
import {
  ChevronDown,
  ChevronRight,
  Sparkles,
  Loader2,
  Settings2,
  CalendarClock,
} from "lucide-react";
import { toast } from "sonner";
import { useRegisterCommand } from "@/lib/commandRegistry";
import { PromptEnhanceWorkspace } from "./PromptEnhanceWorkspace";
import { PromptHistoryPopover } from "./PromptHistoryPopover";
import { CloudEnhanceButton } from "./CloudEnhanceButton";
import type { PromptEnhanceRequest } from "@/api/types/promptEnhance";

export function PromptEditor() {
  const prompt = useGenerationStore((s) => s.prompt);
  const negativePrompt = useGenerationStore((s) => s.negativePrompt);
  const setParam = useGenerationStore((s) => s.setParam);
  const [showNegative, setShowNegative] = useState(false);
  const [enhanceOpen, setEnhanceOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const promptAutocomplete = useUiStore((s) => s.promptAutocomplete);
  const setPromptAutocomplete = useUiStore((s) => s.setPromptAutocomplete);

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
      const { width, height } = useGenerationStore.getState();
      const inputFrames = useCanvasStore.getState().inputFrames;
      const firstInitial = inputFrames.find(
        (f) => f.mode === "initial" && f.layers.some((l) => l.type === "image"),
      );
      const layers: ImageLayer[] =
        firstInitial && firstInitial.mode === "initial"
          ? firstInitial.layers.filter((l): l is ImageLayer => l.type === "image")
          : [];
      const blob = await flattenCanvas(layers, width, height);
      if (blob) image = await uploadBlob(blob, "vision.png");
    }
    const req: PromptEnhanceRequest = {
      prompt,
      type: "text",
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

  useRegisterCommand({
    id: "prompt:open-history",
    label: "Open prompt history",
    group: "Prompt",
    keywords: ["recent prompts", "previous prompts", "history", "reuse prompt"],
    icon: CalendarClock,
    run: () => setHistoryOpen(true),
  });

  return (
    <div className="flex flex-col gap-2">
      {/* Positive prompt */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-2xs text-muted-foreground">Prompt</Label>
          <div className="flex items-center gap-0.5">
            <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground data-[state=open]:text-primary transition-colors mr-0.5"
                  title="Prompt history"
                  aria-label="Prompt history"
                >
                  <CalendarClock size={14} />
                </button>
              </PopoverTrigger>
              <PopoverContent side="bottom" align="end" className="w-[21rem] p-0">
                <PromptHistoryPopover onClose={() => setHistoryOpen(false)} />
              </PopoverContent>
            </Popover>
            <Button
              variant={promptAutocomplete ? "default" : "outline"}
              size="sm"
              onClick={() => setPromptAutocomplete(!promptAutocomplete)}
              className="h-5 px-1.5 text-3xs rounded mr-1"
              title={promptAutocomplete ? "Autocomplete is on" : "Autocomplete is off"}
            >
              AC
            </Button>
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
            <CloudEnhanceButton />
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
          {showNegative ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Negative prompt
        </CollapsibleTrigger>
        <CollapsibleContent forceMount>
          <KeepAlivePanel lazy active={showNegative} activeClassName="" hiddenClassName="hidden">
            <PromptField
              value={negativePrompt}
              onChange={(v) => setParam("negativePrompt", v)}
              placeholder="What to avoid..."
              className="min-h-[3.125rem] mt-1.5"
            />
          </KeepAlivePanel>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
