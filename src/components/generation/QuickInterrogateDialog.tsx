import { useState, useCallback, useRef, useEffect } from "react";
import { Loader2, Copy, Send, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useOpenClipCaption,
  useTaggerCaption,
  useVqaCaption,
} from "@/api/hooks/useCaption";
import { useOptionsSubset } from "@/api/hooks/useSettings";
import { useCaptionSettingsStore } from "@/stores/captionSettingsStore";
import { sendPromptToGeneration } from "@/lib/sendTo";
import { uploadFile } from "@/lib/upload";
import { CUSTOM_PROMPT_TASKS } from "@/lib/captionModels";
import { toast } from "sonner";

type CaptionDefaultType = "VLM" | "OpenCLiP" | "Tagger";

const CAPTION_TYPE_MAP: Record<CaptionDefaultType, "vlm" | "openclip" | "tagger"> = {
  VLM: "vlm",
  OpenCLiP: "openclip",
  Tagger: "tagger",
};

interface QuickInterrogateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: File | null;
}

export function QuickInterrogateDialog({
  open,
  onOpenChange,
  file,
}: QuickInterrogateDialogProps) {
  const [caption, setCaption] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const abortedRef = useRef(false);

  const { data: captionOpts } = useOptionsSubset(["caption_default_type"]);
  const defaultType = (captionOpts?.caption_default_type as CaptionDefaultType) ?? "VLM";
  const method = CAPTION_TYPE_MAP[defaultType] ?? "vlm";

  const openclipMut = useOpenClipCaption();
  const taggerMut = useTaggerCaption();
  const vqaMut = useVqaCaption();

  const runCaption = useCallback(
    async (imageFile: File) => {
      setIsRunning(true);
      setCaption(null);
      abortedRef.current = false;
      try {
        const ref = await uploadFile(imageFile);
        if (abortedRef.current) return;

        const settings = useCaptionSettingsStore.getState();
        let result: string | undefined;

        if (method === "vlm") {
          const s = settings.vlm;
          const res = await vqaMut.mutateAsync({
            image: ref,
            model: s.model,
            question: s.task,
            prompt: CUSTOM_PROMPT_TASKS.includes(s.task) ? s.customPrompt : undefined,
            system: s.system,
            max_tokens: s.maxTokens,
            temperature: s.temperature,
            top_k: s.topK,
            top_p: s.topP,
            num_beams: s.numBeams,
            do_sample: s.doSample,
          });
          result = res.answer;
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
          result = res.caption;
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
          });
          result = res.tags;
        }

        if (!abortedRef.current) {
          setCaption(result ?? "No caption returned");
        }
      } catch (err) {
        if (!abortedRef.current) {
          toast.error("Interrogation failed", {
            description: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        if (!abortedRef.current) setIsRunning(false);
      }
    },
    [method, vqaMut, openclipMut, taggerMut],
  );

  // Auto-run when dialog opens with a file
  useEffect(() => {
    if (open && file) {
      setPreviewUrl(URL.createObjectURL(file));
      runCaption(file);
    }
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // Only trigger on open/file changes, not previewUrl
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, file, runCaption]);

  const handleClose = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        abortedRef.current = true;
        setCaption(null);
        setIsRunning(false);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, previewUrl],
  );

  const handleCopy = useCallback(() => {
    if (caption) {
      navigator.clipboard.writeText(caption);
      toast.success("Caption copied to clipboard");
    }
  }, [caption]);

  const handleUseAsPrompt = useCallback(() => {
    if (caption) {
      sendPromptToGeneration(caption);
      toast.success("Caption sent to prompt");
      handleClose(false);
    }
  }, [caption, handleClose]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md max-h-[60vh] p-0 gap-0 overflow-hidden flex flex-col" showCloseButton>
        <DialogDescription className="sr-only">
          Quick interrogate an image using the default caption method
        </DialogDescription>

        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b">
          <DialogTitle className="text-sm font-semibold">Quick Interrogate</DialogTitle>
          <span className="text-3xs text-muted-foreground uppercase tracking-wider">
            {defaultType}
          </span>
        </div>

        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Preview */}
          {previewUrl && (
            <div className="flex items-center justify-center p-4 border-b bg-muted/10">
              <img
                src={previewUrl}
                alt="Preview"
                className="max-w-full max-h-40 rounded object-contain"
              />
            </div>
          )}

          {/* Result */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-4">
              {isRunning ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" />
                  Interrogating with {defaultType}...
                </div>
              ) : caption ? (
                <div className="bg-muted/30 rounded p-3 text-2xs whitespace-pre-wrap break-words">
                  {caption}
                </div>
              ) : !file ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Upload size={32} className="mb-2 opacity-40" />
                  <p className="text-xs">No image provided</p>
                </div>
              ) : null}
            </div>
          </ScrollArea>

          {/* Actions */}
          {caption && (
            <div className="flex items-center gap-2 px-4 py-2.5 border-t bg-muted/10">
              <Button size="sm" variant="secondary" onClick={handleCopy}>
                <Copy size={14} />
                Copy
              </Button>
              <Button size="sm" onClick={handleUseAsPrompt}>
                <Send size={14} />
                Use as Prompt
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
