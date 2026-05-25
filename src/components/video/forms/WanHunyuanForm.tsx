import { useVideoStore } from "@/stores/videoStore";
import { SectionLeader } from "@/components/ui/section-leader";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { ParamGrid } from "@/components/generation/ParamRow";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { VideoOutputSection } from "./VideoOutputSection";
import { VideoPresetSelector } from "../VideoPresetSelector";

// Generic Wan/Hunyuan/etc. video form. Engine + model are picked in the
// top-level ModelSelector (Video view); this form only owns the operational
// param surface (sampling, size, conditioning, VAE) plus the shared
// VideoOutputSection.
export function WanHunyuanForm() {
  const width = useVideoStore((s) => s.width);
  const height = useVideoStore((s) => s.height);
  const frames = useVideoStore((s) => s.frames);
  const steps = useVideoStore((s) => s.steps);
  const seed = useVideoStore((s) => s.seed);
  const guidanceScale = useVideoStore((s) => s.guidanceScale);
  const guidanceTrue = useVideoStore((s) => s.guidanceTrue);
  const samplerShift = useVideoStore((s) => s.samplerShift);
  const dynamicShift = useVideoStore((s) => s.dynamicShift);
  const initStrength = useVideoStore((s) => s.initStrength);
  const vaeType = useVideoStore((s) => s.vaeType);
  const vaeTileFrames = useVideoStore((s) => s.vaeTileFrames);
  const setParam = useVideoStore((s) => s.setParam);

  return (
    <div className="space-y-1">
      <VideoPresetSelector domain="video" />

      <SectionLeader title="Parameters" collapsible defaultCollapsed>
        <ParamGrid>
          <ParamSlider
            label="Steps"
            value={steps}
            onChange={(v) => setParam("steps", v)}
            min={1}
            max={100}
            step={1}
          />

          <ParamSlider
            label="Guidance"
            value={guidanceScale}
            onChange={(v) => setParam("guidanceScale", v)}
            min={0}
            max={20}
            step={0.5}
          />

          <ParamSlider
            label="True CFG"
            value={guidanceTrue}
            onChange={(v) => setParam("guidanceTrue", v)}
            min={-1}
            max={20}
            step={0.5}
          />

          <ParamSlider
            label="Shift"
            value={samplerShift}
            onChange={(v) => setParam("samplerShift", v)}
            min={-1}
            max={20}
            step={0.5}
          />
        </ParamGrid>
        <ParamSlider
          label="Seed"
          value={seed}
          onChange={(v) => setParam("seed", v)}
          min={-1}
          max={999999999}
          step={1}
        />

        <div className="flex items-center gap-2">
          <Label className="text-2xs text-muted-foreground w-16 shrink-0">Dynamic</Label>
          <Switch checked={dynamicShift} onCheckedChange={(v) => setParam("dynamicShift", v)} />
        </div>
      </SectionLeader>

      <SectionLeader title="Size" collapsible defaultCollapsed>
        <ParamGrid>
          <ParamSlider
            label="Width"
            value={width}
            onChange={(v) => setParam("width", v)}
            min={256}
            max={1920}
            step={16}
          />

          <ParamSlider
            label="Height"
            value={height}
            onChange={(v) => setParam("height", v)}
            min={256}
            max={1920}
            step={16}
          />
        </ParamGrid>
        <ParamSlider
          label="Frames"
          value={frames}
          onChange={(v) => setParam("frames", v)}
          min={1}
          max={256}
          step={1}
        />
      </SectionLeader>

      <SectionLeader title="Inputs" collapsible defaultCollapsed>
        <ParamSlider
          label="Strength"
          value={initStrength}
          onChange={(v) => setParam("initStrength", v)}
          min={0}
          max={1}
          step={0.05}
        />
      </SectionLeader>

      <SectionLeader title="Decode" collapsible defaultCollapsed>
        <div className="flex items-center gap-2">
          <Label className="text-2xs text-muted-foreground w-16 shrink-0">VAE type</Label>
          <Combobox
            value={vaeType}
            onValueChange={(v) => setParam("vaeType", v)}
            options={["Default", "Tiny", "Remote", "Upscale"]}
            className="h-6 text-2xs flex-1"
          />
        </div>
        <ParamSlider
          label="Tile frames"
          value={vaeTileFrames}
          onChange={(v) => setParam("vaeTileFrames", v)}
          min={0}
          max={64}
          step={1}
        />
      </SectionLeader>

      <VideoOutputSection />
    </div>
  );
}
