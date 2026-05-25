export type {
  ItemTaggerModelV2 as TaggerModel,
  ItemVlmModelV2 as VlmModel,
  ReqOpenClipV2 as OpenClipRequest,
  ReqTaggerV2 as TaggerRequest,
  ReqVqaV2 as VqaRequest,
  ResOpenClipV2 as OpenClipResponse,
  ResTaggerV2 as TaggerResponse,
  ResVqaV2 as VqaResponse,
} from "@/lib/openapi-generated/types.gen";

// Local UI types - not in OpenAPI.
//
// CaptionMethod is the discriminator the UI uses across caption modes;
// the backend distinguishes them by route, not a discriminator field.
// CloudCaptionResult is the in-memory shape built from a cloud-job
// response; the wire shape is JobResult-based.

export type CaptionMethod = "vlm" | "openclip" | "tagger" | "cloud";

export interface CloudCaptionResult {
  text: string;
  provider: string;
  model: string;
  mode: "caption" | "vqa";
}
