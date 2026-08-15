import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { useVideoStore } from "@/stores/videoStore";
import { useUiStore } from "@/stores/uiStore";
import { useActiveVideoCaps } from "@/hooks/useActiveVideoCaps";
import { isLocalVideoModel } from "@/lib/videoModel";
import { alignCanvas, alignFrames } from "@/lib/video/capsSlider";
import {
  WIRE_TO_STORE,
  type VideoParamKey,
  type VideoParamValues,
} from "@/lib/video/paramRegistry";
import type { VideoModelCaps } from "@/api/types/video";

type DefaultsUpdate = Partial<VideoParamValues>;

function collect(caps: VideoModelCaps): [string, number | boolean][] {
  const d = caps.defaults;
  const entries: [string, number | boolean | null][] = [
    ["width", d.width],
    ["height", d.height],
    ["frames", d.frames],
    ["steps", d.steps],
    ["guidance_scale", d.guidance_scale],
    ["sampler_shift", d.sampler_shift],
    ["dynamic_shift", d.dynamic_shift],
    ["fps", d.fps],
    ["resolution", d.resolution],
    ["duration", d.duration],
  ];
  return entries.filter((e): e is [string, number | boolean] => e[1] !== null);
}

/** On a video model switch: clamp constrained params unconditionally,
 * re-default params the user has not touched, and offer the rest as a
 * one-toast suggestion (auto-applied when the model-defaults setting is on).
 * Mirrors useModelDefaultsSuggester's prevRef/skip-first-render shape. */
export function useVideoCapsDefaults() {
  const activeModel = useModelSelectionStore((s) => s.activeModel);
  const caps = useActiveVideoCaps();
  const prevIdentity = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const identity = isLocalVideoModel(activeModel)
      ? `${activeModel.engine}/${activeModel.model}`
      : null;
    if (prevIdentity.current === undefined) {
      prevIdentity.current = identity;
      return;
    }
    if (identity === prevIdentity.current) return;
    prevIdentity.current = identity;
    if (identity === null) return;

    const state = useVideoStore.getState();
    const map = WIRE_TO_STORE[caps.job_type];

    const apply: DefaultsUpdate = {};
    const suggest: DefaultsUpdate = {};
    const suggestions: [VideoParamKey, number | boolean][] = [];
    for (const [wire, value] of collect(caps)) {
      const key = map[wire];
      if (!key) continue;
      if (state[key] === value) continue;
      if (state.touched.has(key)) {
        (suggest as Record<string, unknown>)[key] = value;
        suggestions.push([key, value]);
      } else {
        (apply as Record<string, unknown>)[key] = value;
      }
    }

    // Constraint clamps are not preferences: they apply even to touched keys.
    const clamps: DefaultsUpdate = {};
    const framesKey = map["frames"];
    if (framesKey) {
      const v = ((apply as Record<string, unknown>)[framesKey] ?? state[framesKey]) as number;
      const aligned = alignFrames(v, caps);
      if (aligned !== v) (clamps as Record<string, unknown>)[framesKey] = aligned;
    }
    for (const axis of ["width", "height"] as const) {
      const key = map[axis];
      if (!key) continue;
      const v = ((apply as Record<string, unknown>)[key] ?? state[key]) as number;
      const aligned = alignCanvas(v, caps, axis);
      if (aligned !== v) (clamps as Record<string, unknown>)[key] = aligned;
    }
    if (caps.fps_fixed != null && map["fps"] && state.fps !== caps.fps_fixed) {
      clamps.fps = caps.fps_fixed;
    }
    Object.assign(apply, clamps);

    if (Object.keys(apply).length > 0) {
      state.applyCapsDefaults(apply);
    }

    if (suggestions.length === 0) return;
    const modelName = isLocalVideoModel(activeModel) ? activeModel.name : "model";
    const summary = suggestions.map(([k, v]) => `${k} ${String(v)}`).join(", ");
    if (useUiStore.getState().autoApplyModelDefaults) {
      useVideoStore.getState().applyCapsDefaults(suggest);
      toast.success(`Applied defaults for ${modelName}: ${summary}`);
    } else {
      toast(`${modelName}`, {
        description: `Suggested: ${summary}`,
        action: {
          label: "Apply",
          onClick: () => {
            useVideoStore.getState().applyCapsDefaults(suggest);
            toast.success(`Applied defaults for ${modelName}`);
          },
        },
        duration: 8000,
      });
    }
  }, [activeModel, caps]);
}
