import { SectionLeader } from "@/components/ui/section-leader";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { ParamGrid } from "@/components/generation/ParamRow";
import { ParamLabel } from "@/components/generation/ParamLabel";
import { Combobox } from "@/components/ui/combobox";
import { useWireParam } from "./useWireParam";
import type { VideoModelCaps } from "@/api/types/video";
import type { VideoJobType } from "@/lib/video/paramRegistry";

interface SectionProps {
  caps: VideoModelCaps;
  job: VideoJobType;
}

const DECODE_TIMESTEP_HELP =
  "Noise level the VAE is told the latents sit at, on models whose decoder is timestep-conditioned. That much fresh noise is blended in before decoding, and the decoder removes it along with the residual latent artifacts that would otherwise render as speckle.<br>Raising it hides more artifacts and softens fine detail.<br><br>Default 0.05.";

const NOISE_SCALE_HELP =
  "Noise mixed into the conditioning image latents before sampling. A small amount stops the model copying the input frame verbatim and settles the flicker where conditioned frames meet generated ones.<br>Higher values loosen the tie to the input image.<br><br>Default 0.025.";

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
    <SectionLeader
      title="Decode"
      collapsible
      defaultCollapsed
      tooltip="Controls for turning the finished latents into pixels. Reach for these when decode runs out of VRAM on a long clip, or when the output carries speckle and flicker the preview did not show."
    >
      {vaeType.key !== undefined && (
        <div className="flex items-center gap-2">
          <ParamLabel
            className="text-2xs text-muted-foreground w-16 shrink-0"
            tooltip="Which VAE decodes the latents.<br><b>Default</b> and <b>Full</b> use the model's own VAE for the best quality.<br><b>Tiny</b> swaps in a lightweight decoder that is much faster and far lighter on VRAM, at the cost of fine detail and some color drift.<br><b>Remote</b> sends the latents to an external decode service, keeping VRAM free at the cost of upload time."
          >
            VAE type
          </ParamLabel>
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
          tooltip="Decodes the clip in temporal tiles of this many frames instead of all at once, which is what keeps VAE decode inside VRAM on long clips.<br>Tiling only engages when the clip is longer than this value, so a tile wider than <b><i>Frames</i></b> does nothing. Smaller tiles use less memory and can leave seams at the joins.<br><br>Set to 0 to decode the whole clip in one pass."
          keywords={["vae", "tiling", "temporal", "vram", "memory", "oom"]}
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
              tooltip={
                caps.stages.decode_timestep ? DECODE_TIMESTEP_HELP : "Not used by this model family"
              }
              keywords={["decode timestep", "vae", "denoise", "speckle", "artifacts"]}
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
                caps.stages.image_cond_noise_scale
                  ? NOISE_SCALE_HELP
                  : "Not used by this model family"
              }
              keywords={["image cond", "conditioning", "init noise", "flicker"]}
            />
          )}
        </ParamGrid>
      )}
    </SectionLeader>
  );
}
