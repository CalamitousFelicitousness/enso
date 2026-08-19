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
          tooltip="Enlarge the clip in latent space between the base pass and the refine pass.<br>Far cheaper than sampling at the target size outright, but it only rescales what the base pass already rendered - it cannot invent detail.<br><br>Enabling <b>Refine</b> without this couples them at a fixed 2x anyway."
        >
          {upsampleRatio.key !== undefined && (
            <ParamSlider
              label="Ratio"
              tooltip="How far the latent upsample enlarges each side of the frame. 2 doubles width and height; the result is snapped to the nearest frame size the model accepts.<br><br>Ignored when <b>Upsample</b> is off and <b>Refine</b> is on: that pairing halves the base pass and hard-codes 2x."
              keywords={["upsample", "scale", "resize", "super resolution"]}
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
          tooltip="Run a second diffusion pass over the upsampled clip to put detail back at the larger size.<br>Costs another full sampling run, so it roughly doubles generation time."
        >
          {refineStrength.key !== undefined && (
            <ParamSlider
              label="Strength"
              tooltip="How much the refine pass is allowed to change the upsampled clip. Low values sharpen and clean up; high values re-generate content and can break the motion the base pass established.<br>0.3 to 0.5 adds detail without disturbing movement.<br><br>Newer model families run a fixed refine recipe and ignore this."
              keywords={["denoise", "refine strength", "second pass"]}
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
