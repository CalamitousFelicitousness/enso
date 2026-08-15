import { SectionLeader } from "@/components/ui/section-leader";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { ParamGrid } from "@/components/generation/ParamRow";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { canvasSliderProps, frameSliderProps } from "@/lib/video/capsSlider";
import { useWireParam } from "./useWireParam";
import type { VideoModelCaps } from "@/api/types/video";
import type { VideoJobType } from "@/lib/video/paramRegistry";

interface SectionProps {
  caps: VideoModelCaps;
  job: VideoJobType;
}

export function SizeSection({ caps, job }: SectionProps) {
  const width = useWireParam<number>(job, "width");
  const height = useWireParam<number>(job, "height");
  const frames = useWireParam<number>(job, "frames");
  const resolution = useWireParam<number>(job, "resolution");
  const duration = useWireParam<number>(job, "duration");
  const autoDuration = useWireParam<boolean>(job, "auto_duration");

  const autoDurationOn = caps.stages.auto_duration && (autoDuration.value ?? false);

  return (
    <SectionLeader title="Size" collapsible defaultCollapsed>
      {caps.sizing_mode === "dimensions" && width.key !== undefined && height.key !== undefined && (
        <ParamGrid>
          <ParamSlider
            label="Width"
            value={width.value ?? caps.defaults.width}
            onChange={width.set}
            {...canvasSliderProps(caps, "width")}
            defaultValue={caps.defaults.width}
          />
          <ParamSlider
            label="Height"
            value={height.value ?? caps.defaults.height}
            onChange={height.set}
            {...canvasSliderProps(caps, "height")}
            defaultValue={caps.defaults.height}
          />
        </ParamGrid>
      )}
      {caps.sizing_mode === "resolution" && resolution.key !== undefined && (
        <ParamSlider
          label="Resolution"
          value={resolution.value ?? caps.defaults.resolution ?? 640}
          onChange={resolution.set}
          min={caps.resolution_min}
          max={caps.resolution_max}
          step={caps.resolution_multiple}
          defaultValue={caps.defaults.resolution ?? undefined}
        />
      )}
      {caps.length_mode === "frames" && frames.key !== undefined && (
        <ParamSlider
          label="Frames"
          value={frames.value ?? caps.defaults.frames}
          onChange={frames.set}
          {...frameSliderProps(caps)}
          disabled={autoDurationOn}
          tooltip={autoDurationOn ? "Clip length is predicted from the prompt" : undefined}
          defaultValue={caps.defaults.frames}
        />
      )}
      {caps.length_mode === "duration" && duration.key !== undefined && caps.duration_rule && (
        <ParamSlider
          label="Duration"
          value={duration.value ?? caps.defaults.duration ?? 4}
          onChange={duration.set}
          min={caps.duration_rule.min}
          max={caps.duration_rule.max}
          step={caps.duration_rule.step}
          defaultValue={caps.defaults.duration ?? undefined}
        />
      )}
      {caps.stages.auto_duration && autoDuration.key !== undefined && (
        <div className="flex items-center gap-2">
          <Label className="text-2xs text-muted-foreground w-16 shrink-0">Auto length</Label>
          <Switch checked={autoDuration.value ?? false} onCheckedChange={autoDuration.set} />
        </div>
      )}
    </SectionLeader>
  );
}
