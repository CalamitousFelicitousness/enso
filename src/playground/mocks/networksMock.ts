import type { ExtraNetworksResponse, PromptStyleV2 } from "@/api/types/models";

/** Realistic mock data for NetworksTab playground rendering. */

// Deterministic placeholder images — picsum with seed so they're stable across reloads
const img = (seed: number) => `https://picsum.photos/seed/${seed}/300/400`;

export const mockExtraNetworks: ExtraNetworksResponse = {
  items: [
    // Models — varying name lengths
    { name: "sd_xl_base_1.0", type: "model", title: "Stable Diffusion XL Base 1.0", fullname: "sd_xl_base_1.0", filename: "/models/Stable-diffusion/sd_xl_base_1.0.safetensors", hash: "31e35c80fc", preview: img(101), version: "SDXL 1.0", tags: [], size: 6_938_000_000, mtime: "2025-01-15T10:30:00Z" },
    { name: "flux1-dev-bnb-nf4-v2", type: "model", title: "FLUX.1 Dev BnB NF4 v2", fullname: "flux1-dev-bnb-nf4-v2", filename: "/models/Stable-diffusion/flux1-dev-bnb-nf4-v2.safetensors", hash: "a1b2c3d4e5", preview: img(102), version: "Flux", tags: ["Quantized"], size: 12_300_000_000, mtime: "2025-02-20T14:15:00Z" },
    { name: "v6", type: "model", title: "V6", fullname: "v6", filename: "/models/Stable-diffusion/v6.safetensors", hash: "f6g7h8i9j0", preview: img(103), version: "SDXL 1.0", tags: [], size: 6_940_000_000, mtime: "2025-03-01T09:00:00Z" },
    { name: "dreamshaper_8_LCM_pruned_emaonly_fp16_nunchaku_distilled_community_v3.1_final", type: "model", title: "DreamShaper 8 LCM Pruned EMAOnly FP16 Nunchaku Distilled Community v3.1 Final", fullname: "dreamshaper_8_LCM_pruned_emaonly_fp16_nunchaku_distilled_community_v3.1_final", filename: "/models/Stable-diffusion/dreamshaper_8_LCM_pruned_emaonly_fp16_nunchaku_distilled_community_v3.1_final.safetensors", hash: "k1l2m3n4o5", preview: img(104), version: "SD 1.5", tags: ["Community", "Distilled", "Nunchaku"], size: 2_130_000_000, mtime: "2024-11-10T16:45:00Z" },
    { name: "juggernautXL_v9Rundiffusion", type: "model", title: "Juggernaut XL v9 Rundiffusion", fullname: "juggernautXL_v9Rundiffusion", filename: "/models/Stable-diffusion/juggernautXL_v9Rundiffusion.safetensors", hash: "aa1122bb33", preview: img(105), version: "SDXL 1.0", tags: ["Community"], size: 6_940_000_000, mtime: "2025-02-28T12:00:00Z" },
    { name: "RV", type: "model", title: null, fullname: "RV", filename: "/models/Stable-diffusion/RV.safetensors", hash: "cc4455dd66", preview: img(106), version: "SD 1.5", tags: [], size: 2_130_000_000, mtime: "2024-10-05T09:00:00Z" },
    // LoRAs — varying name lengths
    { name: "xl", type: "lora", title: "XL", fullname: "xl", filename: "/models/Lora/xl.safetensors", hash: "p6q7r8s9t0", preview: img(201), version: "SDXL 1.0", tags: [], size: 269_000_000, mtime: "2025-01-20T11:00:00Z" },
    { name: "lcm-lora-sdxl", type: "lora", title: "LCM LoRA SDXL", fullname: "lcm-lora-sdxl", filename: "/models/Lora/lcm-lora-sdxl.safetensors", hash: "u1v2w3x4y5", preview: img(202), version: "SDXL 1.0", tags: ["Distilled"], size: 393_000_000, mtime: "2025-02-05T08:30:00Z" },
    { name: "ip-adapter-plus-face-sdxl-vit-h_fp16_nf4_optimized_tensorrt_v2", type: "lora", title: "IP-Adapter Plus Face SDXL ViT-H FP16 NF4 Optimized TensorRT v2", fullname: "ip-adapter-plus-face-sdxl-vit-h_fp16_nf4_optimized_tensorrt_v2", filename: "/models/Lora/ip-adapter-plus-face-sdxl-vit-h_fp16_nf4_optimized_tensorrt_v2.safetensors", hash: "z6a7b8c9d0", preview: img(203), version: "SDXL 1.0", tags: ["Quantized"], size: 702_000_000, mtime: "2025-01-25T13:20:00Z" },
    { name: "add-detail-xl", type: "lora", title: "Add Detail XL", fullname: "add-detail-xl", filename: "/models/Lora/add-detail-xl.safetensors", hash: "e1f2g3h4i5", preview: img(204), version: "SDXL 1.0", tags: ["Community"], size: 52_000_000, mtime: "2025-03-10T07:15:00Z" },
    { name: "film-grain-cinematic-look-extremely-detailed-photorealistic-lora-v4", type: "lora", title: "Film Grain Cinematic Look Extremely Detailed Photorealistic LoRA v4", fullname: "film-grain-cinematic-look-extremely-detailed-photorealistic-lora-v4", filename: "/models/Lora/film-grain-cinematic-look-extremely-detailed-photorealistic-lora-v4.safetensors", hash: "ff1122aa33", preview: img(205), version: "SDXL 1.0", tags: ["Community"], size: 144_000_000, mtime: "2025-03-05T14:00:00Z" },
    { name: "g", type: "lora", title: null, fullname: "g", filename: "/models/Lora/g.safetensors", hash: "bb4455cc66", preview: null, version: "SD 1.5", tags: [], size: 8_400_000, mtime: "2024-12-01T10:00:00Z" },
    // Embeddings — short and long
    { name: "ng", type: "embedding", title: null, fullname: "ng", filename: "/models/embeddings/ng.pt", hash: "j6k7l8m9n0", preview: null, version: "SD 1.5", tags: [], size: 24_000, mtime: "2024-08-15T12:00:00Z" },
    { name: "EasyNegativeV2", type: "embedding", title: "EasyNegative V2", fullname: "EasyNegativeV2", filename: "/models/embeddings/EasyNegativeV2.safetensors", hash: "dd7788ee99", preview: null, version: "SD 1.5", tags: [], size: 24_000, mtime: "2024-08-20T12:00:00Z" },
    { name: "verybadimagenegative_v1.3_standard_quality_improvement_embedding_for_sd15", type: "embedding", title: "Very Bad Image Negative v1.3 Standard Quality Improvement Embedding for SD1.5", fullname: "verybadimagenegative_v1.3_standard_quality_improvement_embedding_for_sd15", filename: "/models/embeddings/verybadimagenegative_v1.3.safetensors", hash: "ff0011aa22", preview: null, version: "SD 1.5", tags: [], size: 32_000, mtime: "2024-09-10T15:00:00Z" },
    // VAEs
    { name: "sdxl_vae", type: "vae", title: "SDXL VAE", fullname: "sdxl_vae", filename: "/models/VAE/sdxl_vae.safetensors", hash: "o1p2q3r4s5", preview: img(401), version: "SDXL 1.0", tags: [], size: 335_000_000, mtime: "2024-09-01T10:00:00Z" },
    { name: "vae-ft-mse-840000-ema-pruned", type: "vae", title: "VAE FT MSE 840000 EMA Pruned", fullname: "vae-ft-mse-840000-ema-pruned", filename: "/models/VAE/vae-ft-mse-840000-ema-pruned.safetensors", hash: "gg3344hh55", preview: null, version: "SD 1.5", tags: [], size: 335_000_000, mtime: "2024-09-15T10:00:00Z" },
    // Wildcards
    { name: "x", type: "wildcards", title: null, fullname: "x", filename: "/models/wildcards/x.txt", hash: null, preview: null, version: null, tags: [], size: 800, mtime: "2024-10-01T08:00:00Z" },
    { name: "clothing", type: "wildcards", title: null, fullname: "clothing", filename: "/models/wildcards/clothing.txt", hash: null, preview: null, version: null, tags: [], size: 4_200, mtime: "2024-10-01T08:00:00Z" },
    { name: "professional-photography-lighting-setups-and-color-grading-techniques", type: "wildcards", title: null, fullname: "professional-photography-lighting-setups-and-color-grading-techniques", filename: "/models/wildcards/professional-photography-lighting-setups-and-color-grading-techniques.txt", hash: null, preview: null, version: null, tags: [], size: 45_000, mtime: "2024-11-15T08:00:00Z" },
  ],
  total: 20,
  offset: 0,
  limit: 500,
};

export const mockPromptStyles: PromptStyleV2[] = [
  { name: "Cinematic", prompt: "cinematic lighting, film grain, dramatic shadows", negative_prompt: "blurry, low quality, overexposed", extra: null, description: "Cinematic film look", wildcards: null, filename: "/styles/styles.csv", preview: null, mtime: "2025-01-10T08:00:00Z" },
  { name: "Anime", prompt: "anime style, vibrant colors, clean lines", negative_prompt: "photorealistic, 3d render", extra: null, description: "Anime illustration style", wildcards: null, filename: "/styles/styles.csv", preview: null, mtime: "2025-01-10T08:00:00Z" },
  { name: "Photorealistic", prompt: "photorealistic, 8k uhd, DSLR, high quality", negative_prompt: "illustration, painting, drawing, anime", extra: null, description: "Photo-realistic output", wildcards: null, filename: "/styles/styles.csv", preview: null, mtime: "2025-01-10T08:00:00Z" },
  { name: "Oil Painting", prompt: "oil painting, textured canvas, classical art", negative_prompt: "photo, digital art, 3d", extra: null, description: "Classical oil painting", wildcards: null, filename: "/styles/styles.csv", preview: null, mtime: "2025-01-10T08:00:00Z" },
];

export const mockOptions: Record<string, unknown> = {
  sd_model_checkpoint: "sd_xl_base_1.0",
  sd_vae: "Automatic",
};
