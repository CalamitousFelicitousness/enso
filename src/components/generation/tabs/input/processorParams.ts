// How a processor's parameters are shown when the API describes them only by
// their default values.

const COLORMAPS = [
  "None",
  "autumn",
  "bone",
  "jet",
  "winter",
  "rainbow",
  "ocean",
  "summer",
  "spring",
  "cool",
  "hsv",
  "pink",
  "hot",
  "parula",
  "magma",
  "inferno",
  "plasma",
  "viridis",
  "cividis",
  "twilight",
  "shifted",
  "turbo",
  "deepgreen",
];

export const STRING_PARAM_OPTIONS: Record<string, string[]> = {
  color_map: COLORMAPS,
};

/** A slider range for a numeric parameter, from its default alone. */
export function inferSliderRange(defaultValue: number): {
  min: number;
  max: number;
  step: number;
} {
  if (Number.isInteger(defaultValue)) {
    if (defaultValue <= 1) return { min: 0, max: 10, step: 1 };
    if (defaultValue <= 64) return { min: 0, max: Math.max(512, defaultValue * 4), step: 1 };
    if (defaultValue <= 512) return { min: 0, max: Math.max(2048, defaultValue * 4), step: 1 };
    return { min: 0, max: defaultValue * 4, step: 1 };
  }
  if (defaultValue <= 1) return { min: 0, max: 2, step: 0.01 };
  return { min: 0, max: Math.max(10, defaultValue * 4), step: 0.01 };
}
