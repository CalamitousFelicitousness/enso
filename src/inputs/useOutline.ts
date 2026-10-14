import { useEffect, useMemo } from "react";
import { usePreprocessors } from "@/api/hooks/useControl";
import type { Outline, OutlineEnv, ProcessingEnv } from "@/lib/inputs/outline";
import { getInputLimits } from "@/lib/cloudLimits";
import { cloudRule } from "@/lib/imageOptimize";
import { processorFacts } from "@/lib/processorUtils";
import { useInputStore } from "@/stores/inputStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useGenerationSize } from "@/canvas/useGenerationSize";
import { useModelCapabilities } from "@/hooks/useModelCapabilities";
import { useEffectiveLimit } from "./admit";
import { lookupMaps, mapFacts, useMapStore } from "./maps";
import { outlineOf } from "./outlineOf";

/** What the outline needs to say where each map stands, or null until the
 * server has listed its processors. Pictures are placed in Width x Height
 * and go out at the size the canvas shows the request generating at. */
export function useProcessingEnv(): ProcessingEnv | null {
  const { data: preprocessors } = usePreprocessors();
  const { kind } = useModelCapabilities();
  const maps = useMapStore();
  const width = useGenerationStore((s) => s.width);
  const height = useGenerationStore((s) => s.height);
  const target = useGenerationSize();
  const processors = useMemo(
    () => (preprocessors ? processorFacts(preprocessors) : null),
    [preprocessors],
  );
  return useMemo(
    () => processors && mapFacts(processors, maps, kind === "cloud", { width, height }, target),
    [processors, maps, kind, width, height, target],
  );
}

/** The active model's facts the outline reads: what it carries, how many
 * images it takes, whether the request sets its size, where each map stands,
 * the largest picture taken and what it resizes pictures to. */
export function useOutlineEnv(): OutlineEnv {
  const { controlUnified, maxInputImages, requestSetsSize, sizes, model } = useModelCapabilities();
  const processing = useProcessingEnv();
  const inputLimit = useEffectiveLimit();
  const target = useGenerationSize();
  return useMemo(
    () => ({
      controlUnified: controlUnified === true,
      maxInputImages,
      requestSetsSize,
      processing,
      inputLimit,
      sizes: sizes && { ...sizes, target },
      cloud:
        model?.source === "cloud"
          ? { rule: cloudRule(getInputLimits(model.provider, model.id)), target }
          : null,
    }),
    [controlUnified, maxInputImages, requestSetsSize, processing, inputLimit, sizes, model, target],
  );
}

/** The outline under the active model's facts, with the facts, for callers
 * that also act on the frames (Process now, a problem's fix). */
export function useOutlineWithEnv(): { outline: Outline; env: OutlineEnv } {
  const env = useOutlineEnv();
  const outline = useInputStore((s) => outlineOf(s.frames, env));
  return { outline, env };
}

/** The outline under the active model's facts. */
export function useOutline(): Outline {
  return useOutlineWithEnv().outline;
}

/** Ask the cache about every map the outline names that it has not been
 * asked about. Mounted once. */
export function useMapLookups(): void {
  const outline = useOutline();
  useEffect(() => {
    const keys = outline.entries.flatMap((e) =>
      e.maps.filter((m) => m.state === "unknown").map((m) => m.key),
    );
    if (keys.length > 0) void lookupMaps(keys);
  }, [outline]);
}
