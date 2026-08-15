import { SectionLeader } from "@/components/ui/section-leader";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { useWireParam } from "./useWireParam";
import type { VideoModelCaps } from "@/api/types/video";
import type { VideoJobType } from "@/lib/video/paramRegistry";

interface SectionProps {
  caps: VideoModelCaps;
  job: VideoJobType;
}

export function InputsSection({ caps, job }: SectionProps) {
  const initStrength = useWireParam<number>(job, "init_strength");
  const conditionStrength = useWireParam<number>(job, "condition_strength");
  const strength = initStrength.key !== undefined ? initStrength : conditionStrength;

  const hasInputs =
    caps.init_image !== "ignored" || caps.last_image !== "ignored" || caps.references.supported;
  if (!hasInputs) return null;

  const contract = [
    caps.init_image !== "ignored" ? `Init ${caps.init_image}` : null,
    caps.last_image !== "ignored" ? `Last ${caps.last_image}` : null,
    caps.references.supported ? `up to ${caps.references.max_images} references` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <SectionLeader title="Inputs" collapsible defaultCollapsed>
      <p className="text-3xs text-muted-foreground">{contract} - drop images on the canvas</p>
      {strength.key !== undefined && (
        <ParamSlider
          label="Strength"
          value={strength.value ?? 0.5}
          onChange={strength.set}
          min={0}
          max={1}
          step={0.05}
          disabled={!caps.init_strength_applicable}
          tooltip={
            caps.init_strength_applicable ? undefined : "This model does not use input strength"
          }
        />
      )}
    </SectionLeader>
  );
}
