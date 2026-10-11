import { useCallback, useState } from "react";
import { toast } from "sonner";
import { usePromptEnhanceStore } from "@/stores/promptEnhanceStore";
import { usePromptEnhance } from "@/api/hooks/usePromptEnhance";
import { useUploadAction } from "@/hooks/useUploadAction";
import type { UploadBatch } from "@/inputs/uploads";
import { enhanceAction } from "@/lib/media/progress";
import type { PromptEnhanceRequest } from "@/api/types/promptEnhance";

interface PromptEnhancerOptions {
  type: NonNullable<PromptEnhanceRequest["type"]>;
  /** Read at call time so the hook never re-registers on every keystroke. */
  getPrompt: () => string;
  /** Sends the vision picture on the batch, answering its ref, or null for
   * none. Called only when the store asks for vision. Injected rather than
   * branched on `type` so the image canvas and the video inputs stay in
   * their own bundles. */
  getVisionImage: (batch: UploadBatch) => Promise<string | null>;
}

/** Enhance request shared by the image and video prompt surfaces; only the
 * declared type and the vision source differ between them. The vision
 * picture is read once: `action` names its upload's run, which `uploading`
 * covers from the click and `stopUpload` cancels. */
export function usePromptEnhancer({ type, getPrompt, getVisionImage }: PromptEnhancerOptions) {
  const [open, setOpen] = useState(false);
  const enhanceStore = usePromptEnhanceStore();
  const setPendingResult = usePromptEnhanceStore((s) => s.setPendingResult);
  const mutation = usePromptEnhance();
  const action = enhanceAction(type);
  const {
    run: runUpload,
    busy: uploading,
    cancel: stopUpload,
  } = useUploadAction(action, {
    transient: true,
  });

  const enhance = useCallback(async () => {
    const prompt = getPrompt();
    if (!prompt.trim()) {
      toast.warning("Enter a prompt first");
      return;
    }
    let image: string | null = null;
    if (enhanceStore.useVision) {
      try {
        // wrapped, so a picture-less canvas is told apart from a cancel
        const sent = await runUpload(async ({ batch }) => ({ ref: await getVisionImage(batch) }));
        if (!sent) return;
        image = sent.ref;
      } catch (err) {
        toast.error(`Enhance failed: ${err instanceof Error ? err.message : "no vision image"}`);
        return;
      }
    }
    const req: PromptEnhanceRequest = {
      prompt,
      type,
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
    mutation.mutate(req, {
      onSuccess: (res) => {
        setPendingResult({ prompt: res.prompt, seed: res.seed, originalPrompt: prompt });
        setOpen(true);
        toast.success(`Prompt enhanced (seed: ${res.seed})`);
      },
      onError: (err) => {
        toast.error(`Enhance failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      },
    });
  }, [type, getPrompt, getVisionImage, enhanceStore, mutation, setPendingResult, runUpload]);

  return { enhance, isPending: mutation.isPending, action, uploading, stopUpload, open, setOpen };
}
