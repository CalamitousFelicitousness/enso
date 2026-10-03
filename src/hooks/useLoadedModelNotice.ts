import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useCurrentCheckpoint } from "@/api/hooks/useModels";
import { useGenerationStore } from "@/stores/generationStore";
import { useUiStore } from "@/stores/uiStore";
import { getModelDefaults, formatSuggestion } from "@/lib/modelDefaults";

/** Announces a model the server loaded while the page was open, with the
 * suggested settings for its family when the family changed. */
export function useLoadedModelNotice() {
  const { data: checkpoint } = useCurrentCheckpoint();
  // undefined until the server has reported its loaded model once
  const previous = useRef<{ title: string | null; type: string | null } | undefined>(undefined);

  useEffect(() => {
    if (!checkpoint) return;
    const title = checkpoint.loaded ? (checkpoint.title ?? null) : null;
    const type = checkpoint.type ?? null;
    const before = previous.current;
    previous.current = { title, type };
    // The model found loaded when the page opened is not news
    if (!before || title === null || title === before.title) return;

    const modelName = checkpoint.name ?? title;
    const defaults = type === before.type ? null : getModelDefaults(type);
    if (!defaults) {
      toast(`Loaded ${modelName}`);
      return;
    }
    const summary = formatSuggestion(defaults);
    if (useUiStore.getState().autoApplyModelDefaults) {
      useGenerationStore.getState().setParams(defaults);
      toast.success(`Applied defaults for ${modelName}: ${summary}`);
      return;
    }
    toast(`Loaded ${modelName}`, {
      description: `Suggested: ${summary}`,
      action: {
        label: "Apply",
        onClick: () => {
          useGenerationStore.getState().setParams(defaults);
          toast.success(`Applied defaults for ${modelName}`);
        },
      },
      duration: 8000,
    });
  }, [checkpoint]);
}
