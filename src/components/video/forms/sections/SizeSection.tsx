import { SectionLeader } from "@/components/ui/section-leader";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { ParamGrid } from "@/components/generation/ParamRow";
import { ParamLabel } from "@/components/generation/ParamLabel";
import { Switch } from "@/components/ui/switch";
import { canvasSliderProps, frameSliderProps } from "@/lib/video/capsSlider";
import { useWireParam } from "./useWireParam";
import type { VideoModelCaps } from "@/api/types/video";
import type { VideoJobType } from "@/lib/video/paramRegistry";

interface SectionProps {
  caps: VideoModelCaps;
  job: VideoJobType;
}

const FRAMES_HELP =
  "Total frames rendered for the clip. Length in seconds = frames / <b><i>FPS</i></b>.<br>Models only accept counts on their own grid, usually 4n+1 or 8n+1, so the slider steps to legal values. Pushing well past the length a model was trained on brings drift and looping.<br><br>Time and VRAM scale close to linearly with this.";

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
            tooltip="Output frame width in pixels. Video models are trained on a narrow set of frame sizes and drift off-distribution well before image models do, so stay near the size on the model card.<br>The slider steps by the multiple the model requires, so any value it lands on is legal.<br><br>Time and VRAM scale with width x height x frames."
            keywords={["size", "dimensions", "aspect", "frame size"]}
            value={width.value ?? caps.defaults.width}
            onChange={width.set}
            {...canvasSliderProps(caps, "width")}
            defaultValue={caps.defaults.width}
          />
          <ParamSlider
            label="Height"
            tooltip="Output frame height in pixels. Video models are trained on a narrow set of frame sizes and drift off-distribution well before image models do, so stay near the size on the model card.<br>The slider steps by the multiple the model requires, so any value it lands on is legal.<br><br>Time and VRAM scale with width x height x frames."
            keywords={["size", "dimensions", "aspect", "frame size"]}
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
          tooltip="Frame size for engines that size by one number instead of separate width and height. The engine picks the frame shape closest to the input image's aspect ratio, scales it by resolution / 640, and center-crops the image to fit.<br>640 is the native size these models were trained on; going higher costs time and VRAM steeply and starts to break up motion."
          keywords={["size", "dimensions", "frame size", "bucket", "scale"]}
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
          tooltip={autoDurationOn ? "Clip length is predicted from the prompt" : FRAMES_HELP}
          keywords={["length", "clip length", "duration", "frame count"]}
          defaultValue={caps.defaults.frames}
        />
      )}
      {caps.length_mode === "duration" && duration.key !== undefined && caps.duration_rule && (
        <ParamSlider
          label="Duration"
          tooltip="Clip length in seconds, for engines that take a duration instead of a frame count. Frames rendered = duration x <b><i>FPS</i></b>, so raising FPS at a fixed duration costs proportionally more.<br>Long clips are built one section at a time and drift further from the input image the longer they run."
          keywords={["length", "seconds", "clip length"]}
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
          <ParamLabel
            className="text-2xs text-muted-foreground w-16 shrink-0"
            tooltip="Let the model predict the clip length from the prompt with its own duration head, ignoring <b><i>Frames</i></b>.<br><br>Only available on models that ship a duration head."
          >
            Auto length
          </ParamLabel>
          <Switch checked={autoDuration.value ?? false} onCheckedChange={autoDuration.set} />
        </div>
      )}
    </SectionLeader>
  );
}
