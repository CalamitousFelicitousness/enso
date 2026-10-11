import type { JobRequest } from "@/api/types/v2";

interface Retired {
  /** Old name to current. */
  renamed: Readonly<Record<string, string>>;
  dropped: ReadonlySet<string>;
}

const GENERATE: Retired = {
  // generate fields that took control_run's keyword names
  renamed: {
    cfg_end: "cfg_stop",
    diffusers_guidance_rescale: "cfg_rescale",
    image_cfg_scale: "cfg_image",
    pag_scale: "cfg_true",
    pag_adaptive: "cfg_adaptive",
  },
  // none of these reached a pipeline
  dropped: new Set([
    "init_control",
    "save_mask",
    "save_mask_composite",
    "return_mask",
    "return_mask_composite",
    "send_images",
    "override_settings",
  ]),
};

/** Fields a stored request can carry that its job type no longer accepts, by type. */
const RETIRED: Readonly<Partial<Record<string, Retired>>> = {
  generate: GENERATE,
  "xyz-grid": GENERATE,
  // sdnext's FramePack load and run take no attention backend
  framepack: { renamed: {}, dropped: new Set(["attention"]) },
};

/** A stored request under the current job schema. */
export function currentJobRequest(request: JobRequest): JobRequest {
  const fields = request as unknown as Record<string, unknown>;
  const retired = RETIRED[String(fields["type"])];
  if (!retired) return request;
  const { renamed, dropped } = retired;
  const isRetired = (key: string) => Object.hasOwn(renamed, key) || dropped.has(key);
  if (!Object.keys(fields).some(isRetired)) return request;
  const current: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!isRetired(key)) current[key] = value;
  }
  for (const [old, name] of Object.entries(renamed)) {
    if (old in fields && !(name in current)) current[name] = fields[old];
  }
  // pag_scale's 0 meant off; as cfg_true it would switch off a model's default true CFG
  const pag = fields["pag_scale"];
  if ("pag_scale" in fields && !("cfg_true" in fields) && !(typeof pag === "number" && pag > 0)) {
    current["cfg_true"] = -1;
  }
  return current as unknown as JobRequest;
}
