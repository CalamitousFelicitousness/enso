import { useMemo } from "react";
import { useGenerationStore } from "@/stores/generationStore";
import { useShallow } from "zustand/react/shallow";
import { useSamplerList, useCurrentCheckpoint } from "@/api/hooks/useModels";
import { ParamSlider } from "../ParamSlider";
import { SectionLeader, SectionDivider } from "@/components/ui/section-leader";
import { ParamRow, ParamGrid } from "../ParamRow";
import { Combobox, type ComboboxGroup } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { ParamLabel } from "../ParamLabel";
import { Dices, RotateCcw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { GenerationInfo } from "@/api/types/generation";

const SAMPLER_GROUP_ORDER = ["Standard", "FlowMatch", "Res4Lyf"] as const;

export function SamplerTab() {
  const state = useGenerationStore(
    useShallow((s) => ({
      sampler: s.sampler,
      steps: s.steps,
      sigmaMethod: s.sigmaMethod,
      timestepSpacing: s.timestepSpacing,
      betaSchedule: s.betaSchedule,
      predictionMethod: s.predictionMethod,
      timestepsPreset: s.timestepsPreset,
      timestepsOverride: s.timestepsOverride,
      sigmaAdjust: s.sigmaAdjust,
      sigmaAdjustStart: s.sigmaAdjustStart,
      sigmaAdjustEnd: s.sigmaAdjustEnd,
      flowShift: s.flowShift,
      baseShift: s.baseShift,
      maxShift: s.maxShift,
      lowOrder: s.lowOrder,
      thresholding: s.thresholding,
      dynamic: s.dynamic,
      rescale: s.rescale,
      seed: s.seed,
      subseed: s.subseed,
      subseedStrength: s.subseedStrength,
    })),
  );
  const setParam = useGenerationStore((s) => s.setParam);
  const lastResult = useGenerationStore((s) => s.results[0]);
  const { data: checkpoint } = useCurrentCheckpoint();
  const { data: samplers } = useSamplerList(checkpoint?.type);

  const samplerGroups = useMemo<ComboboxGroup[]>(() => {
    if (!samplers) return [];
    const buckets: Record<string, string[]> = {};
    for (const s of samplers) {
      (buckets[s.group] ??= []).push(s.name);
    }
    for (const names of Object.values(buckets)) {
      names.sort((a, b) => a.localeCompare(b));
    }
    return SAMPLER_GROUP_ORDER.filter((g) => buckets[g]?.length).map((g) => ({
      heading: g,
      options: buckets[g],
    }));
  }, [samplers]);

  const lastInfo = useMemo<GenerationInfo | null>(() => {
    if (!lastResult?.info) return null;
    try {
      return JSON.parse(lastResult.info) as GenerationInfo;
    } catch {
      return null;
    }
  }, [lastResult]);

  const set = useMemo(
    () => ({
      sampler: (v: string) => setParam("sampler", v),
      steps: (v: number) => setParam("steps", v),
      sigmaMethod: (v: string) => setParam("sigmaMethod", v),
      timestepSpacing: (v: string) => setParam("timestepSpacing", v),
      betaSchedule: (v: string) => setParam("betaSchedule", v),
      predictionMethod: (v: string) => setParam("predictionMethod", v),
      timestepsPreset: (v: string) => setParam("timestepsPreset", v),
      timestepsOverride: (e: React.ChangeEvent<HTMLInputElement>) =>
        setParam("timestepsOverride", e.target.value),
      sigmaAdjust: (v: number) => setParam("sigmaAdjust", v),
      sigmaAdjustStart: (v: number) => setParam("sigmaAdjustStart", v),
      sigmaAdjustEnd: (v: number) => setParam("sigmaAdjustEnd", v),
      flowShift: (v: number) => setParam("flowShift", v),
      baseShift: (v: number) => setParam("baseShift", v),
      maxShift: (v: number) => setParam("maxShift", v),
      lowOrder: (c: boolean | "indeterminate") => setParam("lowOrder", !!c),
      thresholding: (c: boolean | "indeterminate") =>
        setParam("thresholding", !!c),
      dynamic: (c: boolean) => setParam("dynamic", c),
      rescale: (c: boolean | "indeterminate") => setParam("rescale", !!c),
      seed: (v: number) => setParam("seed", v),
      seedRandom: () => setParam("seed", -1),
      seedReuse: () => {
        if (lastInfo?.seed != null) setParam("seed", lastInfo.seed);
      },
      subseed: (v: number) => setParam("subseed", v),
      subseedRandom: () => setParam("subseed", -1),
      subseedReuse: () => {
        if (lastInfo?.subseed != null) setParam("subseed", lastInfo.subseed);
      },
      subseedStrength: (v: number) => setParam("subseedStrength", v),
    }),
    [setParam, lastInfo],
  );

  return (
    <div className="flex flex-col gap-3 text-sm">
      <SectionLeader title="Sampler" collapsible>
        <ParamGrid>
          <Combobox
            value={state.sampler}
            onValueChange={set.sampler}
            groups={samplerGroups}
            className="h-5 text-2xs"
          />
          <ParamSlider
            label="Steps"
            tooltip="How many times to improve the generated image iteratively; higher values take longer; very low values can produce bad results"
            keywords={["iterations", "quality", "sampling steps"]}
            value={state.steps}
            onChange={set.steps}
            min={1}
            max={150}
          />
        </ParamGrid>
        <SectionDivider label="Options" />
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-2xs text-muted-foreground cursor-pointer">
            <Checkbox checked={state.lowOrder} onCheckedChange={set.lowOrder} />
            <ParamLabel className="text-2xs text-muted-foreground">
              Low order
            </ParamLabel>
          </label>
          <label className="flex items-center gap-1.5 text-2xs text-muted-foreground cursor-pointer">
            <Checkbox
              checked={state.thresholding}
              onCheckedChange={set.thresholding}
            />
            <ParamLabel className="text-2xs text-muted-foreground">
              Thresholding
            </ParamLabel>
          </label>
          <label className="flex items-center gap-1.5 text-2xs text-muted-foreground cursor-pointer">
            <Checkbox checked={state.rescale} onCheckedChange={set.rescale} />
            <ParamLabel className="text-2xs text-muted-foreground">
              Rescale
            </ParamLabel>
          </label>
        </div>
      </SectionLeader>

      <SectionDivider />

      <SectionLeader title="Schedule" collapsible defaultCollapsed>
        <ParamGrid>
          <ParamRow
            label="Sigma"
            tooltip="Controls how noise levels (sigmas) are distributed across diffusion steps. Options:<br>- default: the model default<br>- karras: smoother noise schedule, higher quality with fewer steps<br>- beta: based on beta schedule values<br>- exponential: exponential decay of noise<br>- lambdas: experimental, balances signal-to-noise<br>- flowmatch: tuned for flow-matching models"
            keywords={["scheduler", "karras", "exponential", "sigma method"]}
          >
            <Combobox
              value={state.sigmaMethod}
              onValueChange={set.sigmaMethod}
              options={["default", "karras", "betas", "exponential", "flowmatch", "lambdas"]}
              className="h-6 text-2xs"
            />
          </ParamRow>
          <ParamRow
            label="Spacing"
            tooltip="Determines how timesteps are spaced across the diffusion process. Options:<br>- default: the model default<br>- leading: creates evenly spaced steps<br>- linspace: includes the first and last steps and evenly selects the remaining intermediate steps<br>- trailing: only includes the last step and evenly selects the remaining intermediate steps starting from the end"
            keywords={["scheduler", "linspace", "leading", "trailing", "timestep spacing"]}
          >
            <Combobox
              value={state.timestepSpacing}
              onValueChange={set.timestepSpacing}
              options={["default", "linspace", "leading", "trailing"]}
              className="h-6 text-2xs"
            />
          </ParamRow>
          <ParamRow
            label="Beta"
            tooltip="Defines how beta (noise strength per step) grows. Options:<br>- default: the model default<br>- linear: evenly decays noise per step<br>- scaled: squared version of linear, used only by Stable Diffusion<br>- cosine: smoother decay, often better results with fewer steps<br>- sigmoid: sharp transition, experimental"
            keywords={["scheduler", "linear", "sigmoid", "beta schedule"]}
          >
            <Combobox
              value={state.betaSchedule}
              onValueChange={set.betaSchedule}
              options={[
                "default",
                "linear",
                "scaled",
                "cosine",
                "sigmoid",
                "laplace",
              ]}
              className="h-6 text-2xs"
            />
          </ParamRow>
          <ParamRow
            label="Prediction"
            tooltip="Defines what the model predicts at each step. Options:<br>- default: the model default<br>- epsilon: noise (most common for Stable Diffusion)<br>- sample: direct denoised image prediction, also called as x0 prediction<br>- v_prediction: velocity prediction, used by CosXL and NoobAI VPred models<br>- flow_prediction: used with newer flow-matching models like SD3 and Flux"
            keywords={["scheduler", "epsilon", "v_prediction", "flow", "prediction method"]}
          >
            <Combobox
              value={state.predictionMethod}
              onValueChange={set.predictionMethod}
              options={[
                "default",
                "epsilon",
                "sample",
                "v_prediction",
                "flow_prediction",
              ]}
              className="h-6 text-2xs"
            />
          </ParamRow>
        </ParamGrid>
        <SectionDivider label="Timesteps" />
        <ParamGrid>
          <ParamRow
            label="Preset"
            tooltip="Select a predefined timestep schedule. When set, overrides the default evenly-spaced timesteps with a curated sequence."
            keywords={["timesteps preset"]}
          >
            <Combobox
              value={state.timestepsPreset}
              onValueChange={set.timestepsPreset}
              options={["None"]}
              className="h-6 text-2xs"
            />
          </ParamRow>
          <ParamRow
            label="Override"
            tooltip="Manually specify exact timestep values as a comma-separated descending list (e.g. 999,850,700,550,400). When set, the Steps count and timestep spacing settings are ignored."
            keywords={["timesteps", "custom", "override"]}
          >
            <Input
              value={state.timestepsOverride}
              onChange={set.timestepsOverride}
              placeholder="e.g. 999,850,700,..."
              className="h-6 text-2xs px-2"
            />
          </ParamRow>
        </ParamGrid>
        <SectionDivider label="Sigma" />
        <ParamGrid>
          <ParamSlider
            label="Start"
            tooltip="Starting step when sigma adjust occurs"
            keywords={["sigma", "adjust", "adjust start"]}
            value={state.sigmaAdjustStart}
            onChange={set.sigmaAdjustStart}
            min={0}
            max={1}
            step={0.01}
          />
          <ParamSlider
            label="End"
            tooltip="Ending step when sigma adjust occurs"
            keywords={["sigma", "adjust", "adjust end"]}
            value={state.sigmaAdjustEnd}
            onChange={set.sigmaAdjustEnd}
            min={0}
            max={1}
            step={0.01}
          />
        </ParamGrid>
        <ParamSlider
          label="Adjust"
          tooltip="Adjust sampler sigma value"
          keywords={["sigma", "sigma adjust"]}
          value={state.sigmaAdjust}
          onChange={set.sigmaAdjust}
          min={0.5}
          max={1.5}
          step={0.01}
        />
      </SectionLeader>

      <SectionDivider />

      <SectionLeader title="Shifts" collapsible defaultCollapsed>
        <ParamSlider
          label="Flow shift"
          tooltip="Shift value for flowmatching models. Controls the distribution of denoising steps.<br><br>Values:<br>- >1.0: allocate more steps to early denoising (better structure)<br>-<1.0: allocate more steps to late denoising (better fine details)<br>- 1.0: balanced schedule<br><br>Most flowmatching models use the value of 3 as default. Effectively inactive if dynamic shift is enabled."
          keywords={["shift", "flow"]}
          value={state.flowShift}
          onChange={set.flowShift}
          min={0.1}
          max={10}
          step={0.1}
          disabled={state.dynamic}
        />

        <div className="flex items-center gap-2">
          <ParamLabel
            className="text-2xs text-muted-foreground flex-shrink-0"
            tooltip="Dynamic shifting automatically adjusts the denoising schedule based on your image resolution.<br><br>The scheduler interpolates between base_shift and max_shift based on actual image resolution.<br><br>Enabling disables static Flow shift."
          >
            Dynamic shift
          </ParamLabel>
          <Switch checked={state.dynamic} onCheckedChange={set.dynamic} />
        </div>
        <ParamGrid>
          <ParamSlider
            label="Base shift"
            tooltip="Minimum shift value for low resolutions when using dynamic shifting."
            keywords={["shift", "base"]}
            value={state.baseShift}
            onChange={set.baseShift}
            min={0}
            max={1}
            step={0.01}
            disabled={!state.dynamic}
          />

          <ParamSlider
            label="Max shift"
            tooltip="Maximum shift value for high resolutions when using dynamic shifting."
            keywords={["shift", "maximum"]}
            value={state.maxShift}
            onChange={set.maxShift}
            min={0}
            max={4}
            step={0.01}
            disabled={!state.dynamic}
          />
        </ParamGrid>
      </SectionLeader>

      <SectionDivider />

      <SectionLeader title="Seed" collapsible>
        <ParamGrid>
          <ParamRow
            label="Seed"
            tooltip="Initial seed and variation"
            keywords={["random", "reproducible", "deterministic"]}
          >
            <div className="flex items-center gap-1">
              <NumberInput
                value={state.seed}
                onChange={set.seed}
                fallback={-1}
                className="min-w-0 flex-1 h-6 text-2xs px-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon-xs"
                    className="text-muted-foreground shrink-0"
                    title="Seed options"
                  >
                    <Dices className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={set.seedRandom}>
                    <Dices className="size-3.5" />
                    <span>Random</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={set.seedReuse}
                    disabled={lastInfo?.seed == null}
                  >
                    <RotateCcw className="size-3.5" />
                    <span>
                      {lastInfo?.seed != null
                        ? `Reuse (${lastInfo.seed})`
                        : "Reuse last"}
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </ParamRow>

          <ParamRow
            label="Variation"
            tooltip="Second seed to be mixed with primary seed"
            keywords={["subseed", "variation", "var"]}
          >
            <div className="flex items-center gap-1">
              <NumberInput
                value={state.subseed}
                onChange={set.subseed}
                fallback={-1}
                className="min-w-0 flex-1 h-6 text-2xs px-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon-xs"
                    className="text-muted-foreground shrink-0"
                    title="Variation options"
                  >
                    <Dices className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={set.subseedRandom}>
                    <Dices className="size-3.5" />
                    <span>Random</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={set.subseedReuse}
                    disabled={lastInfo?.subseed == null}
                  >
                    <RotateCcw className="size-3.5" />
                    <span>
                      {lastInfo?.subseed != null
                        ? `Reuse (${lastInfo.subseed})`
                        : "Reuse last"}
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </ParamRow>
        </ParamGrid>

        <ParamSlider
          label="Var. str."
          tooltip="How strong of a variation to produce. At 0, there will be no effect. At 1, you will get the complete picture with variation seed (except for ancestral samplers, where you will just get something)"
          keywords={["subseed", "variation strength"]}
          value={state.subseedStrength}
          onChange={set.subseedStrength}
          min={0}
          max={1}
          step={0.01}
        />
      </SectionLeader>
    </div>
  );
}
