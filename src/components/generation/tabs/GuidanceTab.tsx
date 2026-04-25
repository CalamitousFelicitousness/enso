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
            tooltip="Classifier Free Guidance scale: how strongly the image should conform to prompt. Lower values produce more creative results, higher values make it follow the prompt more strictly; recommended values between 5-10.<br><br>Also known as <b>CFG</b>."
            keywords={["cfg", "classifier free", "prompt adherence"]}
            value={state.cfgScale}
            onChange={set.cfgScale}
            min={0}
            max={30}
            step={0.5}
          />

          <ParamSlider
            label="Guidance end"
            tooltip="Ends the effect of CFG and PAG early: A value of 1 acts as normal, 0.5 stops guidance at 50% of steps"
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
          tooltip="Rescale guidance to avoid overexposed images at higher guidance values"
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
          tooltip="CFG scale used for refiner pass.<br><br>Also known as <b>CFG</b>."
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
            tooltip="Adaptive modifier for attention guidance scale"
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
