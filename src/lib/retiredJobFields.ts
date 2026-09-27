import type { JobRequest } from "@/api/types/v2";

/** Generate fields that took control_run's keyword names, old name to current. */
const RENAMED: Readonly<Record<string, string>> = {
  cfg_end: "cfg_stop",
  diffusers_guidance_rescale: "cfg_rescale",
  image_cfg_scale: "cfg_image",
  pag_scale: "cfg_true",
  pag_adaptive: "cfg_adaptive",
};

/** Generate fields the job schema no longer accepts; none of them reached a pipeline. */
const DROPPED = new Set([
  "init_control",
  "save_mask",
  "save_mask_composite",
  "return_mask",
  "return_mask_composite",
  "send_images",
  "override_settings",
]);

/** A stored generate or XYZ grid request under the current job schema. */
export function currentJobRequest(request: JobRequest): JobRequest {
  const fields = request as unknown as Record<string, unknown>;
  if (fields["type"] !== "generate" && fields["type"] !== "xyz-grid") return request;
  if (!Object.keys(fields).some((key) => key in RENAMED || DROPPED.has(key))) return request;
  const current: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!(key in RENAMED) && !DROPPED.has(key)) current[key] = value;
  }
  for (const [old, name] of Object.entries(RENAMED)) {
    if (old in fields && !(name in current)) current[name] = fields[old];
  }
  // pag_scale's 0 meant off; as cfg_true it would switch off a model's default true CFG
  const pag = fields["pag_scale"];
  if ("pag_scale" in fields && !("cfg_true" in fields) && !(typeof pag === "number" && pag > 0)) {
    current["cfg_true"] = -1;
  }
  return current as unknown as JobRequest;
}
