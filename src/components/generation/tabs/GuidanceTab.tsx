import { useMemo } from "react";
import { useGenerationStore } from "@/stores/generationStore";
import { useShallow } from "zustand/react/shallow";
import { ParamSlider } from "../ParamSlider";
import { SectionLeader, SectionDivider } from "@/components/ui/section-leader";
import { ParamGrid } from "../ParamRow";

export function GuidanceTab() {
  const state = useGenerationStore(
    useShallow((s) => ({
      cfgScale: s.cfgScale,
      cfgEnd: s.cfgEnd,
      guidanceRescale: s.guidanceRescale,
      imageCfgScale: s.imageCfgScale,
      pagScale: s.pagScale,
      pagAdaptive: s.pagAdaptive,
    })),
  );
  const setParam = useGenerationStore((s) => s.setParam);

  const set = useMemo(
    () => ({
      cfgScale: (v: number) => setParam("cfgScale", v),
      cfgEnd: (v: number) => setParam("cfgEnd", v),
      guidanceRescale: (v: number) => setParam("guidanceRescale", v),
      imageCfgScale: (v: number) => setParam("imageCfgScale", v),
      pagScale: (v: number) => setParam("pagScale", v),
      pagAdaptive: (v: number) => setParam("pagAdaptive", v),
    }),
    [setParam],
  );

  return (
    <div className="flex flex-col gap-3 text-sm">
      <SectionLeader title="Guidance" collapsible>
        <ParamGrid>
          <ParamSlider
            label="Guidance scale"
            tooltip="Classifier-Free Guidance scale. How strongly the image should conform to the prompt. Lower values produce more creative, loosely-prompted results; higher values follow the prompt more strictly but can oversaturate or burn out at very high values.<br><br>Recommended values vary by architecture: 5-10 for <i>SDXL</i>/<i>SD1.x</i>, 3-5 for <i>Flux</i> and <i>SD3</i>, 7-10 for video models. Check the model card if unsure.<br><br>Set to 1 (the slider's minimum) to disable guidance entirely. The model then runs only the conditional prediction with no negative-prompt steering.<br><br>Also known as <b>CFG</b>."
            keywords={["cfg", "classifier free", "prompt adherence"]}
            value={state.cfgScale}
            onChange={set.cfgScale}
            min={0}
            max={30}
            step={0.5}
          />

          <ParamSlider
            label="Guidance end"
            tooltip="Ends guidance early. The remaining denoising steps run unguided, which can speed up inference and produce slightly softer, less prompt-locked results. Applied independently to each pipeline pass (base, HiRes, refiner) against that pass's own step count.<br>Example: 0.5 stops guidance at 50% of steps; 0.8 stops at 80%.<br><br>Affects <b><i>Guidance scale</i></b> and <b><i>Refine guidance scale</i></b>, and Perturbed Attention Guidance on <i>SD 1.5</i> and <i>SDXL</i>.<br><br>Set to 1 to keep guidance active for the entire denoising process.<br>1 (no early end) by default."
            keywords={["cfg", "end step"]}
            value={state.cfgEnd}
            onChange={set.cfgEnd}
            min={0}
            max={1}
            step={0.1}
          />
        </ParamGrid>
        <ParamSlider
          label="Rescale"
          tooltip="Rescales the guided noise prediction to avoid the oversaturated, washed-out colors that high Guidance scale values can produce.<br>Useful when running with Guidance scale above 10 or when colors look blown out. Mild values (0.5-0.7) usually fix the issue without affecting prompt adherence.<br><br>Set to 0 to disable rescaling.<br>Disabled by default."
          keywords={["cfg", "guidance rescale"]}
          value={state.guidanceRescale}
          onChange={set.guidanceRescale}
          min={0}
          max={1}
          step={0.05}
        />
      </SectionLeader>

      <SectionDivider />

      <SectionLeader title="Refine Guidance" collapsible defaultCollapsed>
        <ParamSlider
          label="Refine guidance scale"
          tooltip="Guidance scale used for the secondary pass (refiner model or HiRes refine). Behaves like the main Guidance scale but applies only to that secondary pass.<br>For OmniGen this slider controls a separate image-conditioning guidance scale instead, used alongside the main Guidance scale in OmniGen's dual-CFG formula.<br><br>Set to 0 to disable guidance for the secondary pass.<br>Defaults to 6.0.<br><br>Also known as <b>CFG</b>."
          keywords={["cfg", "refine", "second pass"]}
          value={state.imageCfgScale}
          onChange={set.imageCfgScale}
          min={0}
          max={30}
          step={0.1}
        />
      </SectionLeader>

      <SectionDivider />

      <SectionLeader title="Attention Guidance" collapsible defaultCollapsed>
        <ParamGrid>
          <ParamSlider
            label="PAG scale"
            tooltip="Perturbed Attention Guidance scale. Improves sample quality by guiding denoising away from structurally degraded self-attention maps. Works without a negative prompt. 0 disables PAG. Recommended value around 3.0; too high may over-smooth textures."
            keywords={["pag", "perturbed attention", "guidance"]}
            value={state.pagScale}
            onChange={set.pagScale}
            min={0}
            max={30}
            step={0.05}
          />

          <ParamSlider
            label="Adaptive"
            tooltip="Decay rate for the Perturbed Attention Guidance (PAG) component of <b><i>PAG scale</i></b>. Higher values cause PAG strength to decay faster across the denoising steps.<br><br>Only takes effect on <i>SD 1.5</i> and <i>SDXL</i> when <b><i>PAG scale</i></b> is non-zero. Has no effect on <i>Flux</i>, <i>QwenImage</i>, <i>HiDream</i>, or other flow-matching models.<br><br>Default 0.5 applies moderate decay. Set to 0 to keep PAG at full strength for the entire process."
            keywords={["pag", "adaptive", "scaling"]}
            value={state.pagAdaptive}
            onChange={set.pagAdaptive}
            min={0}
            max={1}
            step={0.05}
          />
        </ParamGrid>
      </SectionLeader>
    </div>
  );
}
