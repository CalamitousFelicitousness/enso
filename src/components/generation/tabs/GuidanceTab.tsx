import { useMemo } from "react";
import { useGenerationStore } from "@/stores/generationStore";
import { useModelCapabilities } from "@/hooks/useModelCapabilities";
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

  // Every setting stays live until the loaded pipeline is known
  const guidance = useModelCapabilities().guidance;
  const cfg = guidance?.cfg_applicable ?? true;
  const trueCfg = guidance?.true_cfg_applicable ?? true;
  const rescale = guidance?.rescale_applicable ?? true;
  const pag = guidance?.pag_applicable ?? true;

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
            disabled={!cfg}
            disabledHint={
              trueCfg
                ? "The loaded model ignores Guidance scale; set its CFG with Attention guidance"
                : "The loaded model ignores Guidance scale"
            }
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
            disabled={!cfg && !pag}
            disabledHint="The loaded model ignores Guidance scale, so there is no guidance to end early"
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
          disabled={!rescale}
          disabledHint="The loaded model does not rescale guidance"
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
            label="Attention guidance"
            tooltip="Extra guidance whose kind depends on the model.<br>- <b>SD 1.5 and SDXL</b>: Perturbed Attention Guidance (PAG) for text-to-image, on top of <b><i>Guidance scale</i></b>. Improves structure and detail without a negative prompt; around 3 is typical, too high over-smooths textures.<br>- <b>FLUX.1, Qwen-Image and other flow models that take it</b>: true classifier-free guidance, which gives the negative prompt its effect. 1 or below turns it off.<br><br>0 keeps the model's default: <i>Qwen-Image</i> and <i>Qwen Edit Plus</i> run true CFG 4 by default, most others run without it."
            keywords={["pag", "perturbed attention", "true cfg", "negative prompt"]}
            value={state.pagScale}
            onChange={set.pagScale}
            min={0}
            max={30}
            step={0.05}
            disabled={!trueCfg && !pag}
            disabledHint="The loaded model uses neither true CFG nor PAG"
          />

          <ParamSlider
            label="Adaptive"
            tooltip="Decay rate for Perturbed Attention Guidance (PAG). Higher values make PAG weaken faster across the denoising steps.<br><br>Only takes effect on <i>SD 1.5</i> and <i>SDXL</i> text-to-image when <b><i>Attention guidance</i></b> is above 0. Has no effect on <i>Flux</i>, <i>Qwen-Image</i>, <i>HiDream</i>, or other flow-matching models.<br><br>Default 0.5 applies moderate decay. Set to 0 to keep PAG at full strength for the entire process."
            keywords={["pag", "adaptive", "scaling"]}
            value={state.pagAdaptive}
            onChange={set.pagAdaptive}
            min={0}
            max={1}
            step={0.05}
            disabled={!pag}
            disabledHint="Adaptive shapes PAG, which runs only on SD 1.5 and SDXL"
          />
        </ParamGrid>
      </SectionLeader>
    </div>
  );
}
