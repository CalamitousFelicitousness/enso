import { useMemo, useCallback } from "react";
import { useGenerationStore } from "@/stores/generationStore";
import type { ActiveLora } from "./types";
import { parseActiveLoRAs, addLoRA, removeLoRA, setLoRAWeight } from "./utils";

export function useActiveLoraManager() {
  const prompt = useGenerationStore((s) => s.prompt);

  const activeLoras = useMemo(() => parseActiveLoRAs(prompt), [prompt]);

  const updatePrompt = useCallback((newPrompt: string) => {
    useGenerationStore.getState().setParam("prompt", newPrompt);
  }, []);

  const addLora = useCallback(
    (name: string, weight: number = 1) => {
      updatePrompt(addLoRA(prompt, name, weight));
    },
    [prompt, updatePrompt],
  );

  const removeLora = useCallback(
    (name: string) => {
      updatePrompt(removeLoRA(prompt, name));
    },
    [prompt, updatePrompt],
  );

  const toggleLora = useCallback(
    (name: string) => {
      const exists = activeLoras.some((l) => l.name === name);
      if (exists) {
        updatePrompt(removeLoRA(prompt, name));
      } else {
        updatePrompt(addLoRA(prompt, name, 1));
      }
    },
    [prompt, activeLoras, updatePrompt],
  );

  const setWeight = useCallback(
    (name: string, weight: number) => {
      updatePrompt(setLoRAWeight(prompt, name, weight));
    },
    [prompt, updatePrompt],
  );

  return {
    activeLoras,
    addLora,
    removeLora,
    toggleLora,
    setLoraWeight: setWeight,
  } satisfies {
    activeLoras: ActiveLora[];
    addLora: (name: string, weight?: number) => void;
    removeLora: (name: string) => void;
    toggleLora: (name: string) => void;
    setLoraWeight: (name: string, weight: number) => void;
  };
}
