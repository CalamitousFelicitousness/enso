export interface PromptEnhanceModel {
  name: string;
  group: string;
  vision: boolean;
  thinking: boolean;
  cached: boolean;
}

export interface PromptEnhanceRequest {
  prompt: string;
  type?: "text" | "image" | "video" | undefined;
  model?: string | undefined;
  system_prompt?: string | undefined;
  image?: string | undefined;
  seed?: number | undefined;
  nsfw?: boolean | undefined;
  prefix?: string | undefined;
  suffix?: string | undefined;
  do_sample?: boolean | undefined;
  max_tokens?: number | undefined;
  temperature?: number | undefined;
  repetition_penalty?: number | undefined;
  top_k?: number | undefined;
  top_p?: number | undefined;
  thinking?: boolean | undefined;
  keep_thinking?: boolean | undefined;
  use_vision?: boolean | undefined;
  prefill?: string | undefined;
  keep_prefill?: boolean | undefined;
}

export interface PromptEnhanceResponse {
  ok: boolean;
  prompt: string;
  seed: number;
}
