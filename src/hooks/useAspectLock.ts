import { useCallback, useMemo, useState } from "react";
import { useOptionsSubset } from "@/api/hooks/useSettings";
import {
  axisBounds,
  DEFAULT_ASPECT_RATIOS,
  flipRatioLabel,
  lockedAxisBounds,
  parseAspectRatios,
  ratioFromLabel,
  sizeForPreset,
  snapAxis,
  type AspectPreset,
  type AxisRule,
} from "@/lib/aspect";

/** Ratio presets from the server aspect_ratios option, with a baked fallback. */
export function useAspectPresets(): AspectPreset[] {
  const { data } = useOptionsSubset(["aspect_ratios"]);
  return useMemo(
    () =>
      parseAspectRatios(
        typeof data?.["aspect_ratios"] === "string" ? data["aspect_ratios"] : DEFAULT_ASPECT_RATIOS,
      ),
    [data],
  );
}

interface AspectLockArgs {
  width: number;
  height: number;
  onWidth: (v: number) => void;
  onHeight: (v: number) => void;
  widthRule: AxisRule;
  heightRule: AxisRule;
}

// Aspect-ratio lock shared by the image and video size controls. Owns the
// active preset and wraps the width/height setters so a locked ratio drives
// the other axis; store wiring stays with the caller. The lock is strict:
// widthBounds/heightBounds shrink to the range where the pair stays legal,
// so callers feed them to their sliders instead of the raw rules. Pass
// referentially stable rules (module const or useMemo).
export function useAspectLock({
  width,
  height,
  onWidth,
  onHeight,
  widthRule,
  heightRule,
}: AspectLockArgs) {
  const [storedPreset, setActivePreset] = useState<string | null>(null);

  // A model switch can shrink the rules under an active preset; the lock
  // goes dormant (derived, not cleared) until the ratio fits again.
  const { activePreset, lockedRatio } = useMemo(() => {
    const ratio = ratioFromLabel(storedPreset);
    if (ratio !== null && lockedAxisBounds(widthRule, heightRule, ratio) === null) {
      return { activePreset: null, lockedRatio: null };
    }
    return { activePreset: storedPreset, lockedRatio: ratio };
  }, [storedPreset, widthRule, heightRule]);

  const widthBounds = useMemo(() => {
    if (lockedRatio) {
      const b = lockedAxisBounds(widthRule, heightRule, lockedRatio);
      if (b) return b;
    }
    return axisBounds(widthRule);
  }, [lockedRatio, widthRule, heightRule]);

  const heightBounds = useMemo(() => {
    if (lockedRatio) {
      const b = lockedAxisBounds(heightRule, widthRule, 1 / lockedRatio);
      if (b) return b;
    }
    return axisBounds(heightRule);
  }, [lockedRatio, widthRule, heightRule]);

  const setWidth = useCallback(
    (v: number) => {
      const w = snapAxis(v, { ...widthRule, ...widthBounds });
      onWidth(w);
      if (lockedRatio) onHeight(snapAxis(w / lockedRatio, heightRule));
    },
    [lockedRatio, widthRule, widthBounds, heightRule, onWidth, onHeight],
  );

  const setHeight = useCallback(
    (v: number) => {
      const h = snapAxis(v, { ...heightRule, ...heightBounds });
      onHeight(h);
      if (lockedRatio) onWidth(snapAxis(h * lockedRatio, widthRule));
    },
    [lockedRatio, widthRule, heightRule, heightBounds, onWidth, onHeight],
  );

  const swap = useCallback(() => {
    onWidth(snapAxis(height, widthRule));
    onHeight(snapAxis(width, heightRule));
    // A WxH label (cloud absolute preset) no longer matches after a swap.
    if (activePreset) setActivePreset(flipRatioLabel(activePreset));
  }, [width, height, widthRule, heightRule, onWidth, onHeight, activePreset]);

  const selectPreset = useCallback(
    (preset: AspectPreset | null) => {
      if (!preset) {
        setActivePreset(null);
        return;
      }
      setActivePreset(preset.label);
      const s = sizeForPreset(preset, width, height, widthRule, heightRule);
      onWidth(s.w);
      onHeight(s.h);
    },
    [width, height, widthRule, heightRule, onWidth, onHeight],
  );

  // Cloud absolute presets carry exact provider dimensions; no snapping.
  const selectAbsolute = useCallback(
    (preset: AspectPreset) => {
      setActivePreset(preset.label);
      onWidth(preset.w);
      onHeight(preset.h);
    },
    [onWidth, onHeight],
  );

  const fitsPreset = useCallback(
    (preset: AspectPreset) => lockedAxisBounds(widthRule, heightRule, preset.w / preset.h) !== null,
    [widthRule, heightRule],
  );

  return {
    activePreset,
    locked: activePreset !== null,
    widthBounds,
    heightBounds,
    setWidth,
    setHeight,
    swap,
    selectPreset,
    selectAbsolute,
    fitsPreset,
  };
}
