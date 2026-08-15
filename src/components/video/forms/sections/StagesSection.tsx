import { SectionLeader } from "@/components/ui/section-leader";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { useWireParam } from "./useWireParam";
import type { VideoModelCaps } from "@/api/types/video";
import type { VideoJobType } from "@/lib/video/paramRegistry";

interface SectionProps {
  caps: VideoModelCaps;
  job: VideoJobType;
}

export function StagesSection({ caps, job }: SectionProps) {
  const upsampleEnable = useWireParam<boolean>(job, "upsample_enable");
  const upsampleRatio = useWireParam<number>(job, "upsample_ratio");
  const refineEnable = useWireParam<boolean>(job, "refine_enable");
  const refineStrength = useWireParam<number>(job, "refine_strength");

  return (
    <>
      {caps.stages.upsample && upsampleEnable.key !== undefined && (
        <SectionLeader
          title="Upsample"
          enableable
          enabled={upsampleEnable.value ?? false}
          onToggleEnabled={upsampleEnable.set}
        >
          {upsampleRatio.key !== undefined && (
            <ParamSlider
              label="Ratio"
              value={upsampleRatio.value ?? 2}
              onChange={upsampleRatio.set}
              min={1}
              max={4}
              step={0.5}
            />
          )}
        </SectionLeader>
      )}
      {caps.stages.refine && refineEnable.key !== undefined && (
        <SectionLeader
          title="Refine"
          enableable
          enabled={refineEnable.value ?? false}
          onToggleEnabled={refineEnable.set}
        >
          {refineStrength.key !== undefined && (
            <ParamSlider
              label="Strength"
              value={refineStrength.value ?? 0.4}
              onChange={refineStrength.set}
              min={0.1}
              max={1}
              step={0.05}
            />
          )}
        </SectionLeader>
      )}
    </>
  );
}
