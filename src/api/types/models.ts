import type { ItemSamplerV2 } from "@/lib/openapi-generated/types.gen";

export type {
  ItemExtensionV2 as Extension,
  ItemExtraNetworkDetail as NetworkDetail,
  ItemExtraNetworkV2 as ExtraNetworkV2,
  ItemModelV2 as SdModelV2,
  ItemPromptStyleV2 as PromptStyleV2,
  ItemUpscalerV2 as UpscalerV2,
  ItemVaeV2 as VaeV2,
  ResCheckpointV2 as CheckpointInfoV2,
  ResExtraNetworksV2 as ExtraNetworksResponse,
  ResModelsV2 as SdModelsResponse,
} from "@/lib/openapi-generated/types.gen";

// SamplerV2 narrows `group` to the three sampler families that exist in
// SD.Next. The Pydantic side has `group: str`; this intersection restores
// the literal narrowing for switch-on-group consumers without losing the
// codegen-derived rest of the shape.
export type SamplerV2 = Omit<ItemSamplerV2, "group"> & {
  group: "Standard" | "FlowMatch" | "Res4Lyf";
};
