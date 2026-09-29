import { usePostprocessChoices } from "@/api/hooks/usePostprocess";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { ParamRow, ParamGrid } from "@/components/generation/ParamRow";
import { Combobox } from "@/components/ui/combobox";
import { SectionLeader } from "@/components/ui/section-leader";
import { ProcessSection, CheckRow } from "./ProcessSection";
import { useProcessSection } from "./useProcessSection";

const OPERATIONS = ["NeuralRender", "SuperRes", "FrameGen"];
const MOTIONS = ["Fast", "Medium", "Quality", "Zero"];
const FG_MODES = ["fps", "slowmo"];

export function DlssSection() {
  const { enabled, params, applies, mode, setEnabled, set } = useProcessSection("dlss");
  const nrProfiles = usePostprocessChoices("nVidia DLSS", "nr_profile");
  const ssProfiles = usePostprocessChoices("nVidia DLSS", "ss_profile");
  const ops = params.dlss_enabled;
  const has = (op: string) => ops.includes(op);
  const toggleOp = (op: string, on: boolean) =>
    set("dlss_enabled")(on ? [...ops, op] : ops.filter((o) => o !== op));

  return (
    <ProcessSection
      title="nVidia DLSS"
      tooltip="NVIDIA's neural render, super resolution and frame generation, run as post-processing. Needs a supported GPU."
      enabled={enabled}
      onToggleEnabled={setEnabled}
      applies={applies}
    >
      <ParamRow
        label="Operations"
        tooltip="Which DLSS passes run, in this order. None selected does nothing."
      >
        <div className="flex gap-3">
          {OPERATIONS.map((op) => (
            <CheckRow
              key={op}
              label={op}
              checked={has(op)}
              onCheckedChange={(on) => toggleOp(op, on)}
              disabled={op === "FrameGen" && mode !== "video"}
              title={
                op === "FrameGen" && mode !== "video" ? "Frame generation needs a video" : undefined
              }
            />
          ))}
        </div>
      </ParamRow>
      <SectionLeader
        title="NeuralRender"
        level={1}
        collapsible
        defaultCollapsed
        parentDisabled={!has("NeuralRender")}
      >
        <ParamGrid>
          <ParamRow label="Profile">
            <Combobox
              value={params.nr_profile}
              onValueChange={set("nr_profile")}
              options={nrProfiles.length ? nrProfiles : [params.nr_profile]}
              className="h-6 text-2xs w-full"
            />
          </ParamRow>
          <ParamRow
            label="Motion vector"
            tooltip="Motion estimation quality between frames; Zero disables it."
          >
            <Combobox
              value={params.nr_motion}
              onValueChange={set("nr_motion")}
              options={MOTIONS}
              className="h-6 text-2xs w-full"
            />
          </ParamRow>
        </ParamGrid>
        <ParamGrid>
          <ParamSlider
            label="Scale"
            value={params.nr_scale}
            onChange={set("nr_scale")}
            min={0.1}
            max={4}
            step={0.05}
            decimals={2}
            tooltip="Output size multiplier of the neural render pass."
          />
          <ParamSlider
            label="Intensity"
            value={params.nr_intensity}
            onChange={set("nr_intensity")}
            min={0}
            max={2}
            step={0.05}
            decimals={2}
            tooltip="Overall strength of the pass."
          />
          <ParamSlider
            label="Detail"
            value={params.nr_detail}
            onChange={set("nr_detail")}
            min={0}
            max={2}
            step={0.05}
            decimals={2}
            tooltip="How much fine detail is restored."
          />
          <ParamSlider
            label="Colour"
            value={params.nr_colour}
            onChange={set("nr_colour")}
            min={0}
            max={2}
            step={0.05}
            decimals={2}
            tooltip="How much color is corrected."
          />
          <ParamSlider
            label="Blend"
            value={params.nr_blend}
            onChange={set("nr_blend")}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
            tooltip="Mix between the rendered result and the source."
          />
          <ParamSlider
            label="Radius"
            value={params.nr_radius}
            onChange={set("nr_radius")}
            min={1}
            max={16}
            step={0.5}
            decimals={1}
            tooltip="Neighbourhood size of the detail filter."
          />
          <ParamSlider
            label="Scene threshold"
            value={params.nr_threshold}
            onChange={set("nr_threshold")}
            min={0}
            max={1}
            step={0.05}
            decimals={2}
            tooltip="Frame difference that counts as a scene cut and resets temporal state."
          />
          <ParamSlider
            label="Normalized style"
            value={params.nr_normalized}
            onChange={set("nr_normalized")}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
            tooltip="Pulls the style toward a neutral, normalized look."
          />
          <ParamSlider
            label="Local tone"
            value={params.nr_local_tone}
            onChange={set("nr_local_tone")}
            min={0}
            max={2}
            step={0.05}
            decimals={2}
            tooltip="Local tone mapping strength."
          />
          <ParamSlider
            label="Local structure"
            value={params.nr_local_structure}
            onChange={set("nr_local_structure")}
            min={0}
            max={2}
            step={0.05}
            decimals={2}
            tooltip="Local structure enhancement strength."
          />
          <ParamSlider
            label="Skin structure"
            value={params.nr_skin_structure}
            onChange={set("nr_skin_structure")}
            min={0}
            max={2}
            step={0.05}
            decimals={2}
            tooltip="Extra structure on skin regions; 0 leaves skin alone."
          />
          <ParamSlider
            label="Mask structure"
            value={params.nr_mask_structure}
            onChange={set("nr_mask_structure")}
            min={0}
            max={2}
            step={0.05}
            decimals={2}
            tooltip="Structure enhancement inside masked regions."
          />
        </ParamGrid>
      </SectionLeader>
      <SectionLeader
        title="SuperRes"
        level={1}
        collapsible
        defaultCollapsed
        parentDisabled={!has("SuperRes")}
      >
        <ParamGrid>
          <ParamRow label="Profile">
            <Combobox
              value={params.ss_profile}
              onValueChange={set("ss_profile")}
              options={ssProfiles.length ? ssProfiles : [params.ss_profile]}
              className="h-6 text-2xs w-full"
            />
          </ParamRow>
          <ParamSlider
            label="Scale"
            value={params.ss_scale}
            onChange={set("ss_scale")}
            min={1}
            max={4}
            step={0.1}
            decimals={1}
            tooltip="Output size multiplier of the super resolution pass."
          />
          <ParamSlider
            label="Detail strength"
            value={params.ss_detail}
            onChange={set("ss_detail")}
            min={0}
            max={2}
            step={0.05}
            decimals={2}
            tooltip="How much detail the pass adds."
          />
          <ParamSlider
            label="Colour strength"
            value={params.ss_colour}
            onChange={set("ss_colour")}
            min={0}
            max={2}
            step={0.05}
            decimals={2}
            tooltip="How much color the pass corrects."
          />
          <ParamSlider
            label="Detail radius"
            value={params.ss_radius}
            onChange={set("ss_radius")}
            min={1}
            max={16}
            step={0.5}
            decimals={1}
            tooltip="Neighbourhood size of the detail filter."
          />
          <ParamSlider
            label="Scene threshold"
            value={params.ss_threshold}
            onChange={set("ss_threshold")}
            min={0}
            max={1}
            step={0.05}
            decimals={2}
            tooltip="Frame difference that counts as a scene cut and resets temporal state."
          />
        </ParamGrid>
      </SectionLeader>
      <SectionLeader
        title="FrameGen"
        level={1}
        collapsible
        defaultCollapsed
        parentDisabled={!has("FrameGen")}
      >
        <ParamGrid>
          <ParamSlider
            label="Factor"
            value={params.fg_factor}
            onChange={set("fg_factor")}
            min={2}
            max={4}
            step={1}
            tooltip="Output frames per source frame."
          />
          <ParamRow
            label="Mode"
            tooltip="fps raises the frame rate; slowmo keeps it and stretches time."
          >
            <Combobox
              value={params.fg_mode}
              onValueChange={set("fg_mode")}
              options={FG_MODES}
              className="h-6 text-2xs w-full"
            />
          </ParamRow>
        </ParamGrid>
        <ParamSlider
          label="Scene threshold"
          value={params.fg_threshold}
          onChange={set("fg_threshold")}
          min={0}
          max={1}
          step={0.05}
          decimals={2}
          tooltip="Frame difference that counts as a scene cut; no frames are generated across one."
        />
      </SectionLeader>
      <SectionLeader title="Advanced" level={1} collapsible defaultCollapsed>
        <div className="grid grid-cols-2 gap-1">
          <CheckRow
            label="Full precision"
            checked={params.dlss_full}
            onCheckedChange={set("dlss_full")}
            title="Run in 32-bit; slower, for GPUs that mishandle half precision"
          />
          <CheckRow
            label="CUDA graph"
            checked={params.dlss_graph}
            onCheckedChange={set("dlss_graph")}
            title="Capture the pass as a CUDA graph for faster repeated runs"
          />
        </div>
        <ParamSlider
          label="Chunk size"
          value={params.dlss_chunk}
          onChange={set("dlss_chunk")}
          min={0}
          max={262144}
          step={16384}
          tooltip="Tokens processed per chunk; lower fits less VRAM."
        />
      </SectionLeader>
    </ProcessSection>
  );
}
