//

export interface ModelModule {
  name: string;
  cls: string;
  device: string | null;
  dtype: string | null;
  quant: string | null;
  params: number;
  modules: number;
  config: Record<string, unknown> | null;
}

export interface ModelAnalysis {
  name: string;
  type: string;
  class: string;
  hash: string | null;
  size: number;
  mtime: string | null;
  meta: Record<string, unknown>;
  modules: ModelModule[];
}

export interface ModelSaveRequest {
  name: string;
  path?: string | undefined;
  shard?: string | undefined;
  overwrite?: boolean | undefined;
}

export interface ModelListDetail {
  model_name: string;
  filename: string;
  type: string;
  detected_type: string;
  pipeline: string | null;
  hash: string | null;
  size: number;
  mtime: string | null;
}

//

export interface HfModelResult {
  id: string;
  pipeline_tag: string;
  tags: string;
  downloads: number;
  last_modified: string;
  url: string;
}

export interface HfDownloadRequest {
  hub_id: string;
  token?: string | undefined;
  variant?: string | undefined;
  revision?: string | undefined;
  mirror?: string | undefined;
  custom_pipeline?: string | undefined;
}

export interface CivitaiDownloadRequest {
  url: string;
  name?: string | undefined;
  path?: string | undefined;
  model_type?: string | undefined;
  token?: string | undefined;
}

export interface CivitMetadataScanResult {
  name: string;
  id: number | null;
  type: string;
  code: number;
  hash: string;
  size: number;
  note: string;
}

export interface CivitMetadataUpdateResult {
  file: string | null;
  id: number | null;
  name: string | null;
  sha: string | null;
  versions: number | null;
  latest: string | null;
  status: string | null;
}

//

export interface MergeMethodsInfo {
  methods: string[];
  beta_methods: string[];
  triple_methods: string[];
  docs: Record<string, string>;
  presets: Record<string, number[]>;
  sdxl_presets: Record<string, number[]>;
}

export interface MergeRequest {
  custom_name: string;
  primary_model_name: string;
  secondary_model_name: string;
  merge_mode: string;
  tertiary_model_name?: string | undefined;
  alpha?: number | undefined;
  beta?: number | undefined;
  alpha_preset?: string | undefined;
  alpha_preset_lambda?: number | undefined;
  alpha_base?: string | undefined;
  alpha_in_blocks?: string | undefined;
  alpha_mid_block?: string | undefined;
  alpha_out_blocks?: string | undefined;
  beta_preset?: string | undefined;
  beta_preset_lambda?: number | undefined;
  beta_base?: string | undefined;
  beta_in_blocks?: string | undefined;
  beta_mid_block?: string | undefined;
  beta_out_blocks?: string | undefined;
  precision?: string | undefined;
  checkpoint_format?: string | undefined;
  save_metadata?: boolean | undefined;
  weights_clip?: boolean | undefined;
  prune?: boolean | undefined;
  re_basin?: boolean | undefined;
  re_basin_iterations?: number | undefined;
  device?: string | undefined;
  unload?: boolean | undefined;
  overwrite?: boolean | undefined;
  bake_in_vae?: string | undefined;
}

export interface ReplaceRequest {
  model_type: string;
  model_name: string;
  custom_name: string;
  comp_unet?: string | undefined;
  comp_vae?: string | undefined;
  comp_te1?: string | undefined;
  comp_te2?: string | undefined;
  precision?: string | undefined;
  comp_scheduler?: string | undefined;
  comp_prediction?: string | undefined;
  comp_lora?: string | undefined;
  comp_fuse?: number | undefined;
  meta_author?: string | undefined;
  meta_version?: string | undefined;
  meta_license?: string | undefined;
  meta_desc?: string | undefined;
  meta_hint?: string | undefined;
  create_diffusers?: boolean | undefined;
  create_safetensors?: boolean | undefined;
  debug?: boolean | undefined;
}

//

export interface LoaderComponent {
  id: number;
  name: string;
  loadable: boolean;
  default: string | null;
  class_name: string;
  local: string | null;
  remote: string | null;
  dtype: string | null;
  quant: boolean | null;
}

export interface LoaderComponentsResponse {
  class: string;
  repo: string | null;
  components: LoaderComponent[];
}

export interface LoaderLoadRequest {
  model_type: string;
  repo: string;
  components?:
    | Array<{
        id: number;
        local?: string | undefined;
        remote?: string | undefined;
        dtype?: string | undefined;
        quant?: boolean | undefined;
      }>
    | undefined;
}

export interface LoraExtractRequest {
  filename: string;
  max_rank?: number | undefined;
  auto_rank?: boolean | undefined;
  rank_ratio?: number | undefined;
  modules?: string[] | undefined;
  overwrite?: boolean | undefined;
}

//

export interface ModelProbeArch {
  kind: string;
  family: string;
  display: string;
  confidence: number;
  variant: string | null;
  matched_markers: string[];
}

export interface ModelProbeQuant {
  scheme: string | null;
  format: string | null;
}

// Mirror of the ProbeResult dict from sdnext modules/model_probe.py.
export interface ModelProbe {
  ok: boolean;
  error: string | null;
  container: string;
  tensors: number;
  params: number;
  dtypes: Record<string, number>;
  dominant_dtype: string | null;
  arch: ModelProbeArch;
  quant: ModelProbeQuant;
  metadata: Record<string, string>;
  metadata_present: boolean;
  flags: string[];
}

export interface ModelAuditMismatch {
  kind: string;
  claimed: string;
  actual: string;
}

export interface ModelAuditFile {
  path: string;
  root: string;
  size: number;
  mtime: number;
  kind: string;
  family: string;
  display: string;
  confidence: number;
  variant: string | null;
  dominant_dtype: string | null;
  quant: ModelProbeQuant;
  metadata_present: boolean;
  flags: string[];
  error: string | null;
  mismatches: ModelAuditMismatch[];
}

export interface ModelAuditSummary {
  by_family: Record<string, number>;
  by_scheme: Record<string, number>;
  mismatch_count: number;
  corrupt_count: number;
}

export interface ModelAuditResponse {
  files: ModelAuditFile[];
  summary: ModelAuditSummary;
  scanned: number;
  from_cache: number;
  elapsed: number;
  total: number;
}

export interface ModelAuditRequest {
  roots?: string[] | undefined;
  exts?: string[] | undefined;
  force?: boolean | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
}

export interface ModelAuditFixRename {
  path: string;
  to: string;
  claimed: string;
  actual: string;
  files: string[];
}

export interface ModelAuditFixResponse {
  applied: boolean;
  count: number;
  renames: ModelAuditFixRename[];
}

export interface ModelAuditFixRequest {
  paths?: string[] | undefined;
  apply?: boolean | undefined;
}
