import { SectionLeader } from "@/components/ui/section-leader";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { ParamGrid } from "@/components/generation/ParamRow";
import { ParamLabel } from "@/components/generation/ParamLabel";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useWireParam } from "./useWireParam";
import type { VideoModelCaps } from "@/api/types/video";
import type { VideoJobType } from "@/lib/video/paramRegistry";

interface SectionProps {
  caps: VideoModelCaps;
  job: VideoJobType;
}

const GUIDANCE_HELP =
  "Classifier-Free Guidance scale for the clip. Higher values track the prompt more strictly but stiffen motion and can oversaturate; lower values move more freely and drift off-prompt.<br>Most video models want 4 to 7.<br><br>Set to -1 to use the model's own default.<br><br>Also known as <b>CFG</b>.";

const TRUE_CFG_HELP =
  "Real classifier-free guidance for models that otherwise steer with a baked-in distilled guidance value. It evaluates the negative prompt on a second pass, roughly doubling time per step, and in exchange gives the negative prompt real effect.<br>1 leaves it off; 2 to 4 is the usual working range.<br><br>Set to -1 to leave it to the model.";

const SHIFT_HELP =
  "Flow-matching timestep shift. Above 1 spends more of the schedule on high-noise steps, which firms up structure and motion; below 1 favours the late steps and fine detail.<br>Video models usually default near 3 to 5.<br><br>Set to -1 to leave the model's own scheduler shift alone. Ignored while <b><i>Dynamic</i></b> is on.";

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
            tooltip="Denoising steps per clip. More steps firm up motion and fine detail; too few leave mushy frames and unstable movement.<br>Video costs far more per step than images, so the useful band is narrow - most models sit between 20 and 50, while distilled and turbo variants finish in 4 to 8.<br><br>The default comes from the selected model."
            keywords={["iterations", "sampling steps", "quality"]}
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
            tooltip={caps.guidance.cfg_applicable ? GUIDANCE_HELP : distilledHint}
            keywords={["cfg", "classifier free", "prompt adherence"]}
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
            tooltip={caps.guidance.true_cfg_applicable ? TRUE_CFG_HELP : distilledHint}
            keywords={["cfg", "true cfg", "negative prompt", "distilled"]}
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
            tooltip={caps.sampler.shift_applicable ? SHIFT_HELP : fixedSamplerHint}
            keywords={["flow shift", "sampler shift", "timestep", "schedule"]}
            defaultValue={caps.defaults.sampler_shift}
          />
        )}
      </ParamGrid>
      {seed.key !== undefined && (
        <ParamSlider
          label="Seed"
          tooltip="Starting noise seed. The same seed with the same prompt and settings reproduces the same clip, which is what makes comparing two parameter values meaningful.<br><br>Set to -1 to draw a new random seed on every run."
          keywords={["random", "reproducible", "deterministic"]}
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
          <ParamLabel
            className="text-2xs text-muted-foreground w-16 shrink-0"
            tooltip="Derive the flow-matching shift from the clip's own resolution and length instead of using a fixed value. Takes over from <b><i>Shift</i></b> while it is on.<br><br>Leave it on unless you are tuning shift by hand."
          >
            Dynamic
          </ParamLabel>
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
