import { replaceEqualDeep } from "@tanstack/react-query";
import { computeOutline, type Outline, type OutlineEnv } from "@/lib/inputs/outline";
import type { Frame } from "@/lib/inputs/types";
import { useInputStore } from "@/stores/inputStore";
import { useModelCapabilities } from "@/hooks/useModelCapabilities";

interface Cached {
  frames: Frame[];
  outline: Outline;
}

/** One entry per distinct env, so callers that pass none and callers that pass
 * the model's facts each keep their own identities. */
const cache = new Map<string, Cached>();
const CACHE_SIZE = 4;

const envKey = (env: OutlineEnv) =>
  `${env.controlUnified ? 1 : 0}/${env.maxInputImages ?? ""}/${env.requestSetsSize ?? ""}`;

/** The outline of a frame list. Parts that did not change keep their
 * identity from one list to the next, so a mask stroke or a layer move hands
 * every consumer the outline it already has. */
export function outlineOf(frames: Frame[], env: OutlineEnv = {}): Outline {
  const key = envKey(env);
  const last = cache.get(key);
  if (last?.frames === frames) return last.outline;
  const next = computeOutline(frames, env);
  const outline = last ? replaceEqualDeep(last.outline, next) : next;
  cache.delete(key);
  cache.set(key, { frames, outline });
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  return outline;
}

/** The outline under the active model's facts: what it carries, how many
 * images it takes, and whether the request sets its size. */
export function useOutline(): Outline {
  const { controlUnified, maxInputImages, requestSetsSize } = useModelCapabilities();
  return useInputStore((s) =>
    outlineOf(s.frames, {
      controlUnified: controlUnified === true,
      maxInputImages,
      requestSetsSize,
    }),
  );
}
