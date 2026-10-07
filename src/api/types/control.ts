export type ControlUnitType = "controlnet" | "t2i" | "xs" | "lite" | "style_transfer" | "ip";

/** Map frontend unit type → backend API string (only types that differ or need explicit mapping). */
export const BACKEND_UNIT_TYPE: Partial<Record<ControlUnitType, string>> = {
  controlnet: "controlnet",
  t2i: "t2i adapter",
  xs: "xs",
  lite: "lite",
  style_transfer: "reference",
};

/** Mirrors ItemPreprocessorV2 in enso_api/models.py. */
export interface PreprocessorInfo {
  name: string;
  group: string;
  /** Default parameters as they were when the server started. */
  params: Record<string, unknown>;
  /** The processing runner's revision, the same for every item; part of a map's identity. */
  revision: string;
}
