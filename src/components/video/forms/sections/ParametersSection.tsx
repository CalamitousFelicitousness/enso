import { SectionLeader } from "@/components/ui/section-leader";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { ParamGrid } from "@/components/generation/ParamRow";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useWireParam } from "./useWireParam";
import type { VideoModelCaps } from "@/api/types/video";
import type { VideoJobType } from "@/lib/video/paramRegistry";

interface SectionProps {
  caps: VideoModelCaps;
  job: VideoJobType;
}

export function ParametersSection({ caps, job }: SectionProps) {
  const steps = useWireParam<number>(job, "steps");
  const guidance = useWireParam<number>(job, "guidance_scale");
  const guidanceTrue = useWireParam<number>(job, "guidance_true");
  const shift = useWireParam<number>(job, "sampler_shift");
  const seed = useWireParam<number>(job, "seed");
  const dynamicShift = useWireParam<boolean>(job, "dynamic_shift");
  const audioFlag = useWireParam<boolean>(job, "audio");
  const audioEnable = useWireParam<boolean>(job, "audio_enable");
  const audio = audioFlag.key !== undefined ? audioFlag : audioEnable;

  const distilledHint = "Guidance-distilled model; CFG is baked into the weights";
  const fixedSamplerHint = caps.sampler.fixed_name
    ? `Model runs its own scheduler (${caps.sampler.fixed_name})`
    : "Model runs a fixed scheduler";

  return (
    <SectionLeader title="Parameters" collapsible defaultCollapsed>
      <ParamGrid>
        {steps.key !== undefined && (
          <ParamSlider
            label="Steps"
            value={steps.value ?? 1}
            onChange={steps.set}
            min={1}
            max={100}
            step={1}
            defaultValue={caps.defaults.steps}
          />
        )}
        {guidance.key !== undefined && (
          <ParamSlider
            label="Guidance"
            value={guidance.value ?? -1}
            onChange={guidance.set}
            min={-1}
            max={20}
            step={0.5}
            disabled={!caps.guidance.cfg_applicable}
            tooltip={caps.guidance.cfg_applicable ? undefined : distilledHint}
            defaultValue={caps.defaults.guidance_scale}
          />
        )}
        {guidanceTrue.key !== undefined && (
          <ParamSlider
            label="True CFG"
            value={guidanceTrue.value ?? -1}
            onChange={guidanceTrue.set}
            min={-1}
            max={20}
            step={0.5}
            disabled={!caps.guidance.true_cfg_applicable}
            tooltip={caps.guidance.true_cfg_applicable ? undefined : distilledHint}
          />
        )}
        {shift.key !== undefined && (
          <ParamSlider
            label="Shift"
            value={shift.value ?? -1}
            onChange={shift.set}
            min={-1}
            max={20}
            step={0.5}
            disabled={!caps.sampler.shift_applicable}
            tooltip={caps.sampler.shift_applicable ? undefined : fixedSamplerHint}
            defaultValue={caps.defaults.sampler_shift}
          />
        )}
      </ParamGrid>
      {seed.key !== undefined && (
        <ParamSlider
          label="Seed"
          value={seed.value ?? -1}
          onChange={seed.set}
          min={-1}
          max={999999999}
          step={1}
        />
      )}

      {dynamicShift.key !== undefined && (
        <div
          className="flex items-center gap-2"
          title={caps.sampler.dynamic_shift_applicable ? undefined : fixedSamplerHint}
        >
          <Label className="text-2xs text-muted-foreground w-16 shrink-0">Dynamic</Label>
          <Switch
            checked={dynamicShift.value ?? false}
            onCheckedChange={dynamicShift.set}
            disabled={!caps.sampler.dynamic_shift_applicable}
          />
        </div>
      )}

      {audio.key !== undefined && caps.audio.produces_audio && (
        <div
          className="flex items-center gap-2"
          title={caps.audio.gateable ? undefined : "Model always produces an audio track"}
        >
          <Label className="text-2xs text-muted-foreground w-16 shrink-0">Audio</Label>
          <Switch
            checked={audio.value ?? false}
            onCheckedChange={audio.set}
            disabled={!caps.audio.gateable}
          />
        </div>
      )}
    </SectionLeader>
  );
}
