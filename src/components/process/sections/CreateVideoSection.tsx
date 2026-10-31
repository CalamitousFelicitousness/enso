import { useMemo } from "react";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { ParamRow, ParamGrid } from "@/components/generation/ParamRow";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { codecLabel } from "@/components/video/codecLabel";
import { useVideoCodecs } from "@/api/hooks/useVideo";
import { FALLBACK_CODECS, codecGroups, codecRow, outputProblem } from "@/lib/video/codecs";
import { ProcessSection, CheckRow } from "./ProcessSection";
import { useProcessSection } from "./useProcessSection";

// sdnext saves these as animated images; every other value names a video codec
const ANIMATIONS = ["GIF", "PNG"];

export function CreateVideoSection() {
  const { enabled, params, applies, setEnabled, set } = useProcessSection("createVideo");
  const codecQuery = useVideoCodecs();
  const codecs = useMemo(
    () => codecQuery.data ?? (codecQuery.isError ? FALLBACK_CODECS : []),
    [codecQuery.data, codecQuery.isError],
  );
  const groups = useMemo(
    () => [{ heading: "Animation", options: ANIMATIONS }, ...codecGroups(codecs)],
    [codecs],
  );
  const isVideo = !ANIMATIONS.includes(params.video_type);
  const description = isVideo ? codecRow(codecs, params.video_type)?.description : undefined;
  const problem = isVideo ? outputProblem(codecs, params.video_type, "") : null;

  return (
    <ProcessSection
      title="Create Video"
      tooltip="Joins every processed image of a batch or folder run into one video, in input order."
      enabled={enabled}
      onToggleEnabled={setEnabled}
      applies={applies}
      inapplicableHint="Needs a batch or folder run with at least two images."
    >
      <ParamGrid>
        <ParamRow label="Video codec">
          <Combobox
            value={params.video_type}
            onValueChange={set("video_type")}
            groups={groups}
            renderLabel={codecLabel}
            searchPlaceholder="Search codecs..."
            className="h-6 text-2xs w-full"
          />
        </ParamRow>
        <ParamRow
          label="Filename"
          tooltip="Saved under the video output folder; empty uses the samples filename pattern."
        >
          <Input
            value={params.filename}
            onChange={(e) => set("filename")(e.target.value)}
            placeholder="auto"
            className="h-6 text-2xs px-2"
          />
        </ParamRow>
      </ParamGrid>
      {description && <p className="text-3xs text-muted-foreground">{description}</p>}
      {problem && <p className="text-3xs text-amber-500">{problem}</p>}
      <ParamGrid>
        <ParamSlider
          label="Duration"
          tooltip="Seconds each image stays on screen."
          value={params.duration}
          onChange={set("duration")}
          min={0.25}
          max={10}
          step={0.25}
          decimals={2}
          suffix="s"
        />
        {isVideo && (
          <ParamSlider
            label="Pad frames"
            tooltip="Extra copies of the first and last frame, so the video holds on them."
            value={params.pad}
            onChange={set("pad")}
            min={0}
            max={24}
            step={1}
          />
        )}
      </ParamGrid>
      {isVideo && (
        <ParamGrid>
          <ParamSlider
            label="Interpolate"
            tooltip="Frames generated between each pair of images for smoother motion. 0 is off."
            value={params.interpolate}
            onChange={set("interpolate")}
            min={0}
            max={24}
            step={1}
          />
          <ParamSlider
            label="Rescale"
            tooltip="Size multiplier for the video frames relative to the images."
            value={params.scale}
            onChange={set("scale")}
            min={0.5}
            max={2}
            step={0.05}
            decimals={2}
          />
        </ParamGrid>
      )}
      {isVideo && (
        <ParamSlider
          label="Change sensitivity"
          tooltip="How different two consecutive images must be for interpolation to treat them as a scene cut instead of blending."
          value={params.change}
          onChange={set("change")}
          min={0}
          max={1}
          step={0.05}
        />
      )}
      {!isVideo && (
        <CheckRow
          label="Loop"
          checked={params.loop}
          onCheckedChange={set("loop")}
          title="Play the animation repeatedly"
        />
      )}
    </ProcessSection>
  );
}
