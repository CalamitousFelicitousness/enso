export type ControlUnitType = "controlnet" | "t2i" | "xs" | "lite" | "style_transfer" | "ip";

/** Map frontend unit type → backend API string (only types that differ or need explicit mapping). */
export const BACKEND_UNIT_TYPE: Partial<Record<ControlUnitType, string>> = {
  controlnet: "controlnet",
  t2i: "t2i adapter",
  xs: "xs",
  lite: "lite",
  style_transfer: "reference",
};

export interface PreprocessorInfo {
  name: string;
  group: string;
  params: Record<string, unknown>;
}

export interface PreprocessResponse {
  ok: boolean;
  model: string;
  image: string;
}
