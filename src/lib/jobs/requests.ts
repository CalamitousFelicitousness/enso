// What a job's request says beyond its settings: the model a video job loads
// when it runs. The local video types load their own, in place of the loaded
// model; a cloud video names a provider's, which loads nothing here.

const LOADS_MODEL = new Set(["video", "framepack", "ltx"]);

/** The model a job loads when it runs; null for none named. */
export interface LoadsModel {
  model: string | null;
}

/** What a job of this type loads when it runs; null for a type that loads nothing. */
export function loadsModel(type: string, request: unknown): LoadsModel | null {
  if (!LOADS_MODEL.has(type)) return null;
  const params: Record<string, unknown> =
    typeof request === "object" && request !== null ? (request as Record<string, unknown>) : {};
  const text = (key: string) => {
    const value = params[key];
    return typeof value === "string" && value.trim() !== "" ? value : null;
  };
  // a video model's name carries its engine's ("WAN 2.2 A14B T2V")
  if (type === "video") return { model: text("model") ?? text("engine") };
  return { model: text(type === "framepack" ? "variant" : "model") };
}
