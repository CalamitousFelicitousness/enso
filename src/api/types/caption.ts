export type CaptionMethod = "vlm" | "openclip" | "tagger";

// ---------------------------------------------------------------------------
// OpenCLIP / BLIP
// ---------------------------------------------------------------------------

export interface OpenClipRequest {
  image: string;
  model?: string | undefined;
  clip_model?: string | undefined;
  blip_model?: string | undefined;
  mode?: string | undefined;
  analyze?: boolean | undefined;
  max_length?: number | null;
  chunk_size?: number | null;
  min_flavors?: number | null;
  max_flavors?: number | null;
  flavor_count?: number | null;
  num_beams?: number | null;
}

export interface OpenClipResponse {
  ok: boolean;
  caption?: string;
  medium?: string;
  artist?: string;
  movement?: string;
  trending?: string;
  flavor?: string;
}

// ---------------------------------------------------------------------------
// Tagger (WaifuDiffusion / DeepBooru)
// ---------------------------------------------------------------------------

export interface TaggerRequest {
  image: string;
  model?: string | undefined;
  threshold?: number | undefined;
  character_threshold?: number | undefined;
  max_tags?: number | undefined;
  include_rating?: boolean | undefined;
  sort_alpha?: boolean | undefined;
  use_spaces?: boolean | undefined;
  escape_brackets?: boolean | undefined;
  exclude_tags?: string | undefined;
  show_scores?: boolean | undefined;
}

export interface TaggerResponse {
  ok: boolean;
  tags: string;
  scores?: Record<string, number> | null;
}

export interface TaggerModel {
  name: string;
  type: string;
}

// ---------------------------------------------------------------------------
// VLM / VQA
// ---------------------------------------------------------------------------

export interface VqaRequest {
  image: string;
  model?: string | undefined;
  question?: string | undefined;
  prompt?: string | null | undefined;
  system?: string | undefined;
  include_annotated?: boolean | undefined;
  max_tokens?: number | null;
  temperature?: number | null;
  top_k?: number | null;
  top_p?: number | null;
  num_beams?: number | null;
  do_sample?: boolean | null;
  thinking_mode?: boolean | null;
  prefill?: string | null;
  keep_thinking?: boolean | null;
  keep_prefill?: boolean | null;
}

export interface VqaResponse {
  ok: boolean;
  answer?: string;
  annotated_image?: string | null;
}

export interface VlmModel {
  name: string;
  group: string;
  repo: string;
  prompts: string[];
  capabilities: string[];
  cached: boolean;
}
