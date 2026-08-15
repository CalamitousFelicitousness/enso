import { SectionLeader } from "@/components/ui/section-leader";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { ParamGrid } from "@/components/generation/ParamRow";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { useWireParam } from "./useWireParam";
import type { VideoModelCaps } from "@/api/types/video";
import type { VideoJobType } from "@/lib/video/paramRegistry";

interface SectionProps {
  caps: VideoModelCaps;
  job: VideoJobType;
}

export function DecodeSection({ caps, job }: SectionProps) {
  const vaeType = useWireParam<string>(job, "vae_type");
  const tileFrames = useWireParam<number>(job, "vae_tile_frames");
  const decodeTimestep = useWireParam<number>(job, "decode_timestep");
  const noiseScale = useWireParam<number>(job, "image_cond_noise_scale");

  const hasAny =
    vaeType.key !== undefined ||
    tileFrames.key !== undefined ||
    decodeTimestep.key !== undefined ||
    noiseScale.key !== undefined;
  if (!hasAny) return null;

  return (
    <SectionLeader title="Decode" collapsible defaultCollapsed>
      {vaeType.key !== undefined && (
        <div className="flex items-center gap-2">
          <Label className="text-2xs text-muted-foreground w-16 shrink-0">VAE type</Label>
          <Combobox
            value={vaeType.value ?? caps.vae_types[0] ?? "Default"}
            onValueChange={vaeType.set}
            options={caps.vae_types}
            className="h-6 text-2xs flex-1"
          />
        </div>
      )}
      {tileFrames.key !== undefined && (
        <ParamSlider
          label="Tile frames"
          value={tileFrames.value ?? 0}
          onChange={tileFrames.set}
          min={0}
          max={64}
          step={1}
        />
      )}
      {(decodeTimestep.key !== undefined || noiseScale.key !== undefined) && (
        <ParamGrid>
          {decodeTimestep.key !== undefined && (
            <ParamSlider
              label="Decode dt"
              value={decodeTimestep.value ?? 0.05}
              onChange={decodeTimestep.set}
              min={0}
              max={1}
              step={0.005}
              disabled={!caps.stages.decode_timestep}
              tooltip={caps.stages.decode_timestep ? undefined : "Not used by this model family"}
            />
          )}
          {noiseScale.key !== undefined && (
            <ParamSlider
              label="Noise scale"
              value={noiseScale.value ?? 0.025}
              onChange={noiseScale.set}
              min={0}
              max={1}
              step={0.005}
              disabled={!caps.stages.image_cond_noise_scale}
              tooltip={
                caps.stages.image_cond_noise_scale ? undefined : "Not used by this model family"
              }
            />
          )}
        </ParamGrid>
      )}
    </SectionLeader>
  );
}
