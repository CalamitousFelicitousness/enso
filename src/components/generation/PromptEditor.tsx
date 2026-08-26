import { useGenerationStore } from "@/stores/generationStore";
import { usePromptEnhanceStore } from "@/stores/promptEnhanceStore";
import { usePromptEnhancer } from "@/hooks/usePromptEnhancer";
import { imageCanvasVisionSource } from "./visionSource";
import { useState } from "react";
import { useUiStore } from "@/stores/uiStore";
import { PromptField } from "./PromptField";
import { ParamLabel } from "@/components/generation/ParamLabel";
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
import { useRegisterCommand } from "@/lib/commandRegistry";
import { PromptEnhanceWorkspace } from "./PromptEnhanceWorkspace";
import { PromptHistoryPopover } from "./PromptHistoryPopover";
import { CloudEnhanceButton } from "./CloudEnhanceButton";

export function PromptEditor() {
  const prompt = useGenerationStore((s) => s.prompt);
  const negativePrompt = useGenerationStore((s) => s.negativePrompt);
  const setParam = useGenerationStore((s) => s.setParam);
  const [showNegative, setShowNegative] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const promptAutocomplete = useUiStore((s) => s.promptAutocomplete);
  const setPromptAutocomplete = useUiStore((s) => s.setPromptAutocomplete);

  const pinned = usePromptEnhanceStore((s) => s.pinned);
  const {
    enhance: handleEnhance,
    isPending: isEnhancing,
    open: enhanceOpen,
    setOpen: setEnhanceOpen,
  } = usePromptEnhancer({
    type: "text",
    getPrompt: () => useGenerationStore.getState().prompt,
    getVisionImage: imageCanvasVisionSource,
  });


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
          <ParamLabel className="text-2xs text-muted-foreground">Prompt</ParamLabel>
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
              disabled={isEnhancing}
              className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              title="Enhance prompt"
            >
              {isEnhancing ? (
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
                    isPending={isEnhancing}
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
