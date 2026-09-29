import { usePostprocessChoices } from "@/api/hooks/usePostprocess";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { ParamRow, ParamGrid } from "@/components/generation/ParamRow";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { SectionLeader } from "@/components/ui/section-leader";
import { ProcessSection, CheckRow } from "./ProcessSection";
import { useProcessSection } from "./useProcessSection";

const FALLBACK_MODELS = ["SeedVR2 3B", "SeedVR2 7B", "SeedVR2 7B Sharp"];

export function SeedvrSection() {
  const { enabled, params, applies, mode, setEnabled, set } = useProcessSection("seedvr");
  const serverModels = usePostprocessChoices("SeedVR", "seedvr_selected");
  const models = serverModels.length ? serverModels : FALLBACK_MODELS;

  return (
    <ProcessSection
      title="SeedVR"
      tooltip="Diffusion upscaler that restores detail rather than interpolating it. Works on images and videos; the 7B models need a lot of VRAM."
      enabled={enabled}
      onToggleEnabled={setEnabled}
      applies={applies}
    >
      <ParamRow
        label="Model"
        tooltip="3B is fast, 7B is sharper and slower, 7B Sharp pushes detail hardest."
      >
        <Combobox
          value={params.seedvr_selected}
          onValueChange={set("seedvr_selected")}
          options={models}
          className="h-6 text-2xs w-full"
        />
      </ParamRow>
      <ParamSlider
        label="Scale"
        tooltip="Output size as a multiple of the input."
        value={params.seedvr_scale}
        onChange={set("seedvr_scale")}
        min={1}
        max={16}
        step={0.1}
        decimals={1}
      />
      <CheckRow
        label="Offload model"
        checked={params.seedvr_offload}
        onCheckedChange={set("seedvr_offload")}
        title="Move the model off the GPU between runs to leave VRAM for generation"
      />
      <SectionLeader title="Advanced" level={1} collapsible defaultCollapsed>
        <ParamGrid>
          <ParamSlider
            label="Steps"
            tooltip="Denoising steps. 1 is the intended setting for these models; more rarely helps."
            value={params.seedvr_steps}
            onChange={set("seedvr_steps")}
            min={1}
            max={99}
            step={1}
          />
          <ParamRow label="Seed" tooltip="-1 picks a random seed.">
            <NumberInput
              value={params.seedvr_seed}
              onChange={set("seedvr_seed")}
              min={-1}
              step={1}
            />
          </ParamRow>
        </ParamGrid>
        <ParamGrid>
          <ParamSlider
            label="Guidance scale"
            tooltip="How strongly the model pushes toward its restoration target; higher can over-sharpen."
            value={params.seedvr_cfg_scale}
            onChange={set("seedvr_cfg_scale")}
            min={0}
            max={15}
            step={0.01}
            decimals={2}
          />
          <ParamSlider
            label="Guidance rescale"
            tooltip="Tames washed-out results at high guidance. 0 is off."
            value={params.seedvr_cfg_rescale}
            onChange={set("seedvr_cfg_rescale")}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
          />
        </ParamGrid>
      </SectionLeader>
      <SectionLeader title="VAE" level={1} collapsible defaultCollapsed>
        <div className="grid grid-cols-2 gap-1">
          <CheckRow
            label="Tiled encode"
            checked={params.seedvr_vae_tile_encode}
            onCheckedChange={set("seedvr_vae_tile_encode")}
            title="Encode in tiles to fit large inputs in VRAM"
          />
          <CheckRow
            label="Tiled decode"
            checked={params.seedvr_vae_tile_decode}
            onCheckedChange={set("seedvr_vae_tile_decode")}
            title="Decode in tiles to fit large outputs in VRAM"
          />
        </div>
        <ParamGrid>
          <ParamSlider
            label="Tile size"
            tooltip="Tile edge in pixels. Larger tiles show fewer seams and need more VRAM."
            value={params.seedvr_tile_size}
            onChange={set("seedvr_tile_size")}
            min={64}
            max={4096}
            step={8}
          />
          <ParamSlider
            label="Tile overlap"
            tooltip="Overlap between tiles as a fraction of the tile, blended to hide seams."
            value={params.seedvr_tile_overlap}
            onChange={set("seedvr_tile_overlap")}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
          />
        </ParamGrid>
        <ParamSlider
          label="VAE memory"
          tooltip="Share of free VRAM the decoder may use."
          value={params.seedvr_vae_memory}
          onChange={set("seedvr_vae_memory")}
          min={0.1}
          max={1}
          step={0.01}
          decimals={2}
        />
      </SectionLeader>
      {mode === "video" && (
        <SectionLeader title="Video" level={1} collapsible defaultCollapsed>
          <ParamGrid>
            <ParamSlider
              label="Batch size"
              tooltip="Frames processed together. More frames keep motion consistent but need more VRAM."
              value={params.seedvr_batch_size}
              onChange={set("seedvr_batch_size")}
              min={1}
              max={64}
              step={1}
            />
            <ParamSlider
              label="Batch overlap"
              tooltip="Frames shared between consecutive batches, blended to hide the join."
              value={params.seedvr_batch_overlap}
              onChange={set("seedvr_batch_overlap")}
              min={0}
              max={16}
              step={1}
            />
          </ParamGrid>
          <ParamSlider
            label="Interpolate"
            tooltip="Frames generated between each pair of source frames. 0 keeps the source frame rate."
            value={params.seedvr_interpolate}
            onChange={set("seedvr_interpolate")}
            min={0}
            max={4}
            step={1}
          />
          <ParamGrid>
            <ParamRow label="Codec">
              <Input
                value={params.seedvr_codec}
                onChange={(e) => set("seedvr_codec")(e.target.value)}
                className="h-6 text-2xs px-2"
              />
            </ParamRow>
            <ParamRow
              label="Codec options"
              tooltip="Encoder settings as key=value pairs, for example crf=16."
            >
              <Input
                value={params.seedvr_codec_opt}
                onChange={(e) => set("seedvr_codec_opt")(e.target.value)}
                className="h-6 text-2xs px-2"
              />
            </ParamRow>
          </ParamGrid>
        </SectionLeader>
      )}
    </ProcessSection>
  );
}
