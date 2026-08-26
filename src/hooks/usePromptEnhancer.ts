import { useCallback, useState } from "react";
import { toast } from "sonner";
import { usePromptEnhanceStore } from "@/stores/promptEnhanceStore";
import { usePromptEnhance } from "@/api/hooks/usePromptEnhance";
import type { PromptEnhanceRequest } from "@/api/types/promptEnhance";

interface PromptEnhancerOptions {
  type: NonNullable<PromptEnhanceRequest["type"]>;
  /** Read at call time so the hook never re-registers on every keystroke. */
  getPrompt: () => string;
  /** Called only when the store asks for vision. Injected rather than
   * branched on `type` so the image canvas and the video inputs stay in
   * their own bundles. */
  getVisionImage: () => Promise<string | null>;
}

/** Enhance request shared by the image and video prompt surfaces; only the
 * declared type and the vision source differ between them. */
export function usePromptEnhancer({ type, getPrompt, getVisionImage }: PromptEnhancerOptions) {
  const [open, setOpen] = useState(false);
  const enhanceStore = usePromptEnhanceStore();
  const setPendingResult = usePromptEnhanceStore((s) => s.setPendingResult);
  const mutation = usePromptEnhance();

  const enhance = useCallback(async () => {
    const prompt = getPrompt();
    if (!prompt.trim()) {
      toast.warning("Enter a prompt first");
      return;
    }
    const image = enhanceStore.useVision ? await getVisionImage() : null;
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
  }, [type, getPrompt, getVisionImage, enhanceStore, mutation, setPendingResult]);

  return { enhance, isPending: mutation.isPending, open, setOpen };
}
