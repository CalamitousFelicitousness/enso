import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePromptEnhanceStore } from "@/stores/promptEnhanceStore";
import { usePromptEnhancer } from "@/hooks/usePromptEnhancer";
import { PromptField } from "./PromptField";
import { ParamLabel } from "./ParamLabel";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { KeepAlivePanel } from "@/components/ui/keep-alive";
import { ChevronDown, ChevronRight, Sparkles, Loader2, Settings2 } from "lucide-react";
import { PromptEnhanceWorkspace } from "./PromptEnhanceWorkspace";
import type { PromptEnhanceRequest } from "@/api/types/promptEnhance";

export interface PromptBlockProps {
  value: string;
  onChange: (v: string) => void;
  negativeValue: string;
  onNegativeChange: (v: string) => void;
  /** collapsible: images. always: local video. hidden: cloud video, which
   * sends no negative prompt. */
  negativeMode?: "collapsible" | "always" | "hidden";
  enhanceType: NonNullable<PromptEnhanceRequest["type"]>;
  getVisionImage: () => Promise<string | null>;
  placeholder?: string;
  negativePlaceholder?: string;
  className?: string;
  negativeClassName?: string;
  /** Buttons rendered left of Enhance. Surface-specific by design: prompt
   * history and cloud enhance are generation-shaped and have no video peer. */
  actions?: ReactNode;
  /** Set on one instance only - TutorialOverlay resolves by first match. */
  tourId?: string;
}

/** Prompt + negative prompt with the enhance controls, shared by the image
 * and video panels. */
export function PromptBlock({
  value,
  onChange,
  negativeValue,
  onNegativeChange,
  negativeMode = "collapsible",
  enhanceType,
  getVisionImage,
  placeholder = "Describe what you want to generate...",
  negativePlaceholder = "What to avoid...",
  className = "min-h-20",
  negativeClassName = "min-h-[3.125rem] mt-1.5",
  actions,
  tourId,
}: PromptBlockProps) {
  const [showNegative, setShowNegative] = useState(false);
  const pinned = usePromptEnhanceStore((s) => s.pinned);

  // Latest-value ref so enhance() reads the current prompt without being
  // rebuilt on every keystroke.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  });
  const getPrompt = useCallback(() => valueRef.current, []);

  const {
    enhance,
    isPending,
    open: enhanceOpen,
    setOpen: setEnhanceOpen,
  } = usePromptEnhancer({ type: enhanceType, getPrompt, getVisionImage });

  // Bound explicitly: PromptEnhancePreview falls back to writing the image
  // prompt when these are absent, which is wrong for any other surface.
  const accept = useCallback((p: string) => onChange(p), [onChange]);

  const negativeField = (
    <PromptField
      value={negativeValue}
      onChange={onNegativeChange}
      placeholder={negativePlaceholder}
      className={negativeClassName}
    />
  );

  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="flex items-center justify-between mb-1">
          <ParamLabel className="text-2xs text-muted-foreground">Prompt</ParamLabel>
          <div className="flex items-center gap-0.5">
            {actions}
            <button
              type="button"
              onClick={() => void enhance()}
              disabled={isPending}
              className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              title="Enhance prompt"
            >
              {isPending ? (
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
                    onEnhance={() => void enhance()}
                    isPending={isPending}
                    onClose={() => setEnhanceOpen(false)}
                    onAccept={accept}
                    onSelectPrompt={accept}
                  />
                </ScrollArea>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <div {...(tourId ? { "data-tour": tourId } : {})}>
          <PromptField
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            className={className}
          />
        </div>
      </div>

      {negativeMode === "always" && negativeField}

      {negativeMode === "collapsible" && (
        <Collapsible open={showNegative} onOpenChange={setShowNegative}>
          <CollapsibleTrigger className="flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground transition-colors">
            {showNegative ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Negative prompt
          </CollapsibleTrigger>
          <CollapsibleContent forceMount>
            <KeepAlivePanel lazy active={showNegative} activeClassName="" hiddenClassName="hidden">
              {negativeField}
            </KeepAlivePanel>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
