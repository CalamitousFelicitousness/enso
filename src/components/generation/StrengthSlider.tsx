import { useCallback } from "react";
import { useGenerationStore } from "@/stores/generationStore";
import { useStrengthSupported } from "@/hooks/useStrengthSupported";
import { ParamSlider } from "@/components/generation/ParamSlider";

/** img2img denoising strength. The Sampler tab carries its own literal copy
 * so the command palette codegen can index it. */
export function StrengthSlider() {
  const value = useGenerationStore((s) => s.denoisingStrength);
  const setParam = useGenerationStore((s) => s.setParam);
  const supported = useStrengthSupported();
  const onChange = useCallback((v: number) => setParam("denoisingStrength", v), [setParam]);
  return (
    <ParamSlider
      label="Denoise"
      tooltip="How far the result may depart from the input image.<br>0 keeps the image as it is, 1 regenerates it from noise; values between blend the two. With a mask, only the painted area changes."
      value={value}
      onChange={onChange}
      min={0}
      max={1}
      step={0.05}
      disabled={!supported}
    />
  );
}
