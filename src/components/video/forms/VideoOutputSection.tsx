import { useMemo } from "react";
import { useVideoStore } from "@/stores/videoStore";
import { SectionLeader } from "@/components/ui/section-leader";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { ParamGrid } from "@/components/generation/ParamRow";
import { ParamLabel } from "@/components/generation/ParamLabel";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { OUTPUT_PRESETS, qualityToCrf, crfToQuality } from "@/lib/videoOutputPresets";
import type { VideoModelCaps } from "@/api/types/video";

const FPS_HELP =
  "Playback rate written into the output container.<br>On <b><i>Frames</i></b>-based models the frame count is fixed, so this only sets playback speed: length in seconds = frames / FPS. On <b><i>Duration</i></b>-based models the frame count comes from duration x FPS, so raising it renders more frames and costs proportionally more.<br><br>Some models lock the rate they were trained at and disable this.";

const presetOptions = OUTPUT_PRESETS.map((p) => p.id);
const presetLabels: Record<string, string> = Object.fromEntries(
  OUTPUT_PRESETS.map((p) => [p.id, p.label]),
);

export function VideoOutputSection({ caps }: { caps?: VideoModelCaps }) {
  const fps = useVideoStore((s) => s.fps);
  const interpolate = useVideoStore((s) => s.interpolate);
  const codec = useVideoStore((s) => s.codec);
  const format = useVideoStore((s) => s.format);
  const codecOptions = useVideoStore((s) => s.codecOptions);
  const outputPreset = useVideoStore((s) => s.outputPreset);
  const outputQuality = useVideoStore((s) => s.outputQuality);
  const saveVideo = useVideoStore((s) => s.saveVideo);
  const saveFrames = useVideoStore((s) => s.saveFrames);
  const saveSafetensors = useVideoStore((s) => s.saveSafetensors);
  const saveThumbnail = useVideoStore((s) => s.saveThumbnail);
  const width = useVideoStore((s) => s.width);
  const fpResolution = useVideoStore((s) => s.fpResolution);
  const setParam = useVideoStore((s) => s.setParam);

  const isCustom = outputPreset === "custom";
  const isLossless = outputPreset === "lossless";
  const showQuality = !isCustom && !isLossless;

  const resolutionHint = useMemo(() => {
    const maxRes = Math.max(width, fpResolution);
    return maxRes > 1080 && outputQuality < 50;
  }, [width, fpResolution, outputQuality]);

  const handlePresetChange = (id: string) => {
    const preset = OUTPUT_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setParam("outputPreset", id);
    if (id !== "custom") {
      setParam("codec", preset.codec);
      setParam("format", preset.format);
      if (preset.codecOptions) {
        setParam("codecOptions", preset.codecOptions);
        setParam("outputQuality", crfToQuality(preset.codecOptions));
      } else {
        setParam("codecOptions", "");
      }
    }
  };

  const handleQualityChange = (value: number) => {
    setParam("outputQuality", value);
    const currentOpts = codecOptions;
    const hasExtraOpts = currentOpts
      .replace(/crf[=:]\d+/, "")
      .replace(/^,|,$/g, "")
      .trim();
    const crfStr = qualityToCrf(value);
    setParam("codecOptions", hasExtraOpts ? `${crfStr},${hasExtraOpts}` : crfStr);
  };

  const presetDescription = OUTPUT_PRESETS.find((p) => p.id === outputPreset)?.description;

  return (
    <SectionLeader title="Output" collapsible defaultCollapsed>
      <div className="flex items-center gap-2">
        <Label className="text-2xs text-muted-foreground w-16 shrink-0">Preset</Label>
        <Combobox
          value={outputPreset}
          onValueChange={handlePresetChange}
          options={presetOptions}
          renderLabel={(_v, label) => presetLabels[_v] ?? label}
          className="h-6 text-2xs flex-1"
        />
      </div>
      {presetDescription && (
        <p className="text-3xs text-muted-foreground ml-18 pl-0.5">{presetDescription}</p>
      )}

      {showQuality && (
        <ParamSlider
          label="Quality"
          tooltip="Encoder quality target, written out as the codec's CRF value: 100 maps to CRF 10, 70 to CRF 22, 10 to CRF 47.<br>Higher values keep more detail and produce larger files. Grain and fast motion need more headroom than static shots.<br><br>Default 70. The <b>Custom</b> preset exposes CRF directly through <b><i>Codec opts</i></b>; <b>Lossless</b> ignores it."
          keywords={["crf", "bitrate", "compression", "encode", "file size"]}
          value={outputQuality}
          onChange={handleQualityChange}
          min={10}
          max={100}
          step={5}
        />
      )}
      {resolutionHint && showQuality && (
        <p className="text-3xs text-amber-500 ml-18 pl-0.5">
          Consider higher quality for this resolution
        </p>
      )}

      {isCustom && (
        <>
          <div className="flex items-center gap-2">
            <Label className="text-2xs text-muted-foreground w-16 shrink-0">Codec</Label>
            <Combobox
              value={codec}
              onValueChange={(v) => setParam("codec", v)}
              options={["libx264", "libx265", "libvpx-vp9", "libaom-av1", "ffv1"]}
              className="h-6 text-2xs flex-1"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-2xs text-muted-foreground w-16 shrink-0">Format</Label>
            <Combobox
              value={format}
              onValueChange={(v) => setParam("format", v)}
              options={["mp4", "webm", "mkv", "gif"]}
              className="h-6 text-2xs flex-1"
            />
          </div>
          <div className="flex items-center gap-2">
            <ParamLabel
              className="text-2xs text-muted-foreground w-16 shrink-0"
              tooltip="Raw ffmpeg encoder flags, comma separated, as <b>key=value</b> pairs. <b>crf=18</b> sets quality, <b>faststart</b> moves the index to the front for web playback.<br><br>Unknown flags are passed straight to the encoder, so a typo fails the save rather than the generation."
            >
              Codec opts
            </ParamLabel>
            <input
              type="text"
              value={codecOptions}
              onChange={(e) => setParam("codecOptions", e.target.value)}
              className="flex-1 h-6 text-2xs px-2 rounded border border-input bg-background"
            />
          </div>
        </>
      )}

      <ParamGrid>
        <ParamSlider
          label="FPS"
          value={fps}
          onChange={(v) => setParam("fps", v)}
          min={caps?.fps_min ?? 1}
          max={caps?.fps_max ?? 60}
          step={1}
          disabled={caps?.fps_fixed != null}
          tooltip={
            caps?.fps_fixed != null ? `Model output is fixed at ${caps.fps_fixed} fps` : FPS_HELP
          }
          keywords={["frame rate", "framerate", "playback speed"]}
        />

        <ParamSlider
          label="Interpolate"
          tooltip="RIFE frames synthesized between each pair of rendered frames. The clip ends up with this many extra frames per gap and the saved frame rate is multiplied to match, so real-time length is unchanged and motion reads smoother.<br>It cannot add detail the sampler never rendered; heavy interpolation smears fast motion and hard cuts.<br><br>FramePack instead samples fewer real frames and treats <b><i>FPS</i></b> as the finished playback rate.<br><br>Set to 0 to save the rendered frames as they are."
          keywords={["rife", "smooth", "motion", "slow motion", "frame blend"]}
          value={interpolate}
          onChange={(v) => setParam("interpolate", v)}
          min={0}
          max={8}
          step={1}
        />
      </ParamGrid>

      <div className="flex items-center gap-2">
        <Label className="text-2xs text-muted-foreground w-16 shrink-0">Video</Label>
        <Switch checked={saveVideo} onCheckedChange={(v) => setParam("saveVideo", v)} />
      </div>
      <div className="flex items-center gap-2">
        <ParamLabel
          className="text-2xs text-muted-foreground w-16 shrink-0"
          tooltip="Also write every rendered frame as a separate image file alongside the video. Useful for hand-editing or re-encoding; costs disk space proportional to the clip length."
        >
          Frames
        </ParamLabel>
        <Switch checked={saveFrames} onCheckedChange={(v) => setParam("saveFrames", v)} />
      </div>
      <div className="flex items-center gap-2">
        <ParamLabel
          className="text-2xs text-muted-foreground w-16 shrink-0"
          tooltip="Also write the raw frame tensor as a safetensors file. Keeps full precision for re-encoding at a different codec or interpolation setting without re-generating the clip."
        >
          Safetensors
        </ParamLabel>
        <Switch checked={saveSafetensors} onCheckedChange={(v) => setParam("saveSafetensors", v)} />
      </div>
      <div className="flex items-center gap-2">
        <Label className="text-2xs text-muted-foreground w-16 shrink-0">Thumbnail</Label>
        <Switch checked={saveThumbnail} onCheckedChange={(v) => setParam("saveThumbnail", v)} />
      </div>
    </SectionLeader>
  );
}
