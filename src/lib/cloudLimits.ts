import type { InputLimits, ProviderPreset } from "@/api/types/cloud";
import type { Provider } from "@/api/types/cloud";
import { queryClient } from "@/main";

const PRESET_INPUT_LIMITS: Record<ProviderPreset, InputLimits> = {
  openrouter: { maxImageBytes: 20_000_000, maxLongestSide: 2048, formats: ["webp", "jpeg", "png"], transport: "base64" },
  openai: { maxImageBytes: 50_000_000, maxLongestSide: null, formats: ["png", "jpeg", "webp"], transport: "multipart" },
  nanogpt: { maxImageBytes: 4_000_000, maxLongestSide: null, formats: ["webp", "jpeg", "png"], transport: "multipart" },
  aihubmix: { maxImageBytes: 50_000_000, maxLongestSide: null, formats: ["png", "jpeg", "webp"], transport: "multipart" },
  ollama: { maxImageBytes: 25_000_000, maxLongestSide: 1120, formats: ["jpeg", "png", "webp"], transport: "base64" },
  custom: { maxImageBytes: 20_000_000, maxLongestSide: null, formats: ["webp", "jpeg", "png"], transport: "multipart" },
};

const INPUT_LIMITS_OVERRIDES: Partial<Record<ProviderPreset, Record<string, Partial<InputLimits>>>> = {
  openai: {
    "dall-e-2": { maxImageBytes: 4_000_000, maxLongestSide: 1024, formats: ["png"] },
  },
};

function getProviderPreset(providerId: string): ProviderPreset {
  const providers = queryClient.getQueryData<Provider[]>(["cloud-providers"]);
  return providers?.find((p) => p.id === providerId)?.preset ?? "custom";
}

export function getInputLimits(providerId: string, modelId: string): InputLimits {
  const preset = getProviderPreset(providerId);
  const base = PRESET_INPUT_LIMITS[preset];
  const overrides = INPUT_LIMITS_OVERRIDES[preset];
  if (!overrides) return base;

  const bareId = modelId.includes("/") ? modelId.split("/").pop()! : modelId;
  for (const [family, override] of Object.entries(overrides)) {
    if (bareId === family || bareId.startsWith(`${family}:`)) {
      return { ...base, ...override };
    }
  }
  return base;
}
