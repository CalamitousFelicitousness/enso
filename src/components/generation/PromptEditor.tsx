import { useCallback, useState } from "react";
import { useGenerationStore } from "@/stores/generationStore";
import { useUiStore } from "@/stores/uiStore";
import { useRegisterCommand } from "@/lib/commandRegistry";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { PromptBlock } from "./PromptBlock";
import { PromptHistoryPopover } from "./PromptHistoryPopover";
import { CloudEnhanceButton } from "./CloudEnhanceButton";
import { imageCanvasVisionSource } from "./visionSource";

/** Images-side prompt surface: PromptBlock plus the history, autocomplete
 * and cloud-enhance controls, which are generation-shaped and stay here. */
export function PromptEditor() {
  const prompt = useGenerationStore((s) => s.prompt);
  const negativePrompt = useGenerationStore((s) => s.negativePrompt);
  const setParam = useGenerationStore((s) => s.setParam);
  const [historyOpen, setHistoryOpen] = useState(false);

  const promptAutocomplete = useUiStore((s) => s.promptAutocomplete);
  const setPromptAutocomplete = useUiStore((s) => s.setPromptAutocomplete);

  const setPrompt = useCallback((v: string) => setParam("prompt", v), [setParam]);
  const setNegative = useCallback((v: string) => setParam("negativePrompt", v), [setParam]);

  useRegisterCommand({
    id: "prompt:open-history",
    label: "Open prompt history",
    group: "Prompt",
    keywords: ["recent prompts", "previous prompts", "history", "reuse prompt"],
    icon: CalendarClock,
    run: () => setHistoryOpen(true),
  });

  return (
    <PromptBlock
      value={prompt}
      onChange={setPrompt}
      negativeValue={negativePrompt}
      onNegativeChange={setNegative}
      negativeMode="collapsible"
      enhanceType="text"
      getVisionImage={imageCanvasVisionSource}
      placeholder="Describe what you want to generate..."
      tourId="prompt-editor"
      actions={
        <>
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
          <CloudEnhanceButton />
        </>
      }
    />
  );
}
