import { useState } from "react";
import { useVideoStore } from "@/stores/videoStore";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { SectionLeader } from "@/components/ui/section-leader";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { ParamGrid } from "@/components/generation/ParamRow";
import { SectionTimeline } from "@/components/video/SectionTimeline";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

// FramePack-specific extension surface. The shared sections own size,
// duration, steps, seed, and decode; this owns the weights, section
// timeline, sampler tuning, and model options that exist only on the
// FramePack wire.
export function FramePackSection() {
  const fpDuration = useVideoStore((s) => s.fpDuration);
  const fpLatentWindowSize = useVideoStore((s) => s.fpLatentWindowSize);
  const fpShift = useVideoStore((s) => s.fpShift);
  const fpCfgScale = useVideoStore((s) => s.fpCfgScale);
  const fpCfgDistilled = useVideoStore((s) => s.fpCfgDistilled);
  const fpCfgRescale = useVideoStore((s) => s.fpCfgRescale);
  const fpStartWeight = useVideoStore((s) => s.fpStartWeight);
  const fpEndWeight = useVideoStore((s) => s.fpEndWeight);
  const fpVisionWeight = useVideoStore((s) => s.fpVisionWeight);
  const fpSectionPrompt = useVideoStore((s) => s.fpSectionPrompt);
  const fpSystemPrompt = useVideoStore((s) => s.fpSystemPrompt);
  const fpTeacache = useVideoStore((s) => s.fpTeacache);
  const fpOptimizedPrompt = useVideoStore((s) => s.fpOptimizedPrompt);
  const fpCfgZero = useVideoStore((s) => s.fpCfgZero);
  const fpPreview = useVideoStore((s) => s.fpPreview);
  const fpAttention = useVideoStore((s) => s.fpAttention);
  const fps = useVideoStore((s) => s.fps);
  const interpolate = useVideoStore((s) => s.interpolate);
  const setParam = useVideoStore((s) => s.setParam);

  // SectionTimeline needs the FramePack variant to compute window layout.
  // Pull it from activeModel; fall back to "Bi-Directional" so the timeline
  // still renders when the section is briefly visible without an active
  // FramePack model selected (KeepAlive can pre-mount).
  const activeModel = useModelSelectionStore((s) => s.activeModel);
  const variant =
    activeModel?.source === "local-video" && activeModel.kind === "framepack"
      ? activeModel.model
      : "Bi-Directional";

  const [rawEdit, setRawEdit] = useState(false);

  return (
    <>
      <SectionLeader title="Weights" collapsible defaultCollapsed>
        <ParamGrid>
          <ParamSlider
            label="Start wt"
            value={fpStartWeight}
            onChange={(v) => setParam("fpStartWeight", v)}
            min={0}
            max={2}
            step={0.05}
          />
          <ParamSlider
            label="End wt"
            value={fpEndWeight}
            onChange={(v) => setParam("fpEndWeight", v)}
            min={0}
            max={2}
            step={0.05}
          />
        </ParamGrid>
        <ParamSlider
          label="Vision wt"
          value={fpVisionWeight}
          onChange={(v) => setParam("fpVisionWeight", v)}
          min={0}
          max={2}
          step={0.05}
        />
      </SectionLeader>

      <SectionLeader title="Sections" collapsible defaultCollapsed>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-2xs text-muted-foreground">Raw edit</Label>
          <Switch checked={rawEdit} onCheckedChange={setRawEdit} />
        </div>
        {rawEdit ? (
          <Textarea
            value={fpSectionPrompt}
            onChange={(e) => setParam("fpSectionPrompt", e.target.value)}
            placeholder="Section prompts (comma or newline separated)"
            className="text-xs min-h-12 resize-y"
          />
        ) : (
          <SectionTimeline
            fps={fps}
            duration={fpDuration}
            latentWindowSize={fpLatentWindowSize}
            variant={variant}
            interpolate={interpolate}
            value={fpSectionPrompt}
            onChange={(v) => setParam("fpSectionPrompt", v)}
          />
        )}
      </SectionLeader>

      <SectionLeader title="Sampler Tuning" collapsible defaultCollapsed>
        <ParamSlider
          label="Window"
          value={fpLatentWindowSize}
          onChange={(v) => setParam("fpLatentWindowSize", v)}
          min={1}
          max={33}
          step={4}
        />
        <ParamGrid>
          <ParamSlider
            label="FP shift"
            value={fpShift}
            onChange={(v) => setParam("fpShift", v)}
            min={0}
            max={20}
            step={0.5}
          />
          <ParamSlider
            label="CFG"
            value={fpCfgScale}
            onChange={(v) => setParam("fpCfgScale", v)}
            min={0}
            max={20}
            step={0.5}
          />
          <ParamSlider
            label="Distilled"
            value={fpCfgDistilled}
            onChange={(v) => setParam("fpCfgDistilled", v)}
            min={0}
            max={20}
            step={0.5}
          />
          <ParamSlider
            label="Rescale"
            value={fpCfgRescale}
            onChange={(v) => setParam("fpCfgRescale", v)}
            min={0}
            max={1}
            step={0.05}
          />
        </ParamGrid>
      </SectionLeader>

      <SectionLeader title="Model Options" collapsible defaultCollapsed>
        <Textarea
          value={fpSystemPrompt}
          onChange={(e) => setParam("fpSystemPrompt", e.target.value)}
          placeholder="System prompt (optional)"
          className="text-xs min-h-9 resize-y"
        />
        <div className="flex items-center gap-2">
          <Label className="text-2xs text-muted-foreground w-16 shrink-0">TeaCache</Label>
          <Switch checked={fpTeacache} onCheckedChange={(v) => setParam("fpTeacache", v)} />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-2xs text-muted-foreground w-16 shrink-0">Optimized</Label>
          <Switch
            checked={fpOptimizedPrompt}
            onCheckedChange={(v) => setParam("fpOptimizedPrompt", v)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-2xs text-muted-foreground w-16 shrink-0">CFG Zero</Label>
          <Switch checked={fpCfgZero} onCheckedChange={(v) => setParam("fpCfgZero", v)} />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-2xs text-muted-foreground w-16 shrink-0">Preview</Label>
          <Switch checked={fpPreview} onCheckedChange={(v) => setParam("fpPreview", v)} />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-2xs text-muted-foreground w-16 shrink-0">Attention</Label>
          <Combobox
            value={fpAttention}
            onValueChange={(v) => setParam("fpAttention", v)}
            options={["Default", "sdpa", "flash", "sage", "xformers"]}
            className="h-6 text-2xs flex-1"
          />
        </div>
      </SectionLeader>
    </>
  );
}
