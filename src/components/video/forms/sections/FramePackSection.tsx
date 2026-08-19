import { useState } from "react";
import { useVideoStore } from "@/stores/videoStore";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { SectionLeader } from "@/components/ui/section-leader";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { ParamGrid } from "@/components/generation/ParamRow";
import { ParamLabel } from "@/components/generation/ParamLabel";
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
      <SectionLeader
        title="Weights"
        collapsible
        defaultCollapsed
        tooltip="How hard the supplied start and end frames pull on the clip, and how much of the input image's look carries through.<br>Leave these at 1 unless the clip ignores a frame you gave it or wanders off the source image."
      >
        <ParamGrid>
          <ParamSlider
            label="Start wt"
            tooltip="Pull of the start image. Below 1 it mixes noise into the opening latent so the first frame is free to depart from the input; at 1 and above the opening frame stays locked.<br>It also sets the start image's share against the end image where both are supplied.<br><br>Default 1. Values above 1 only matter when an end image is present."
            keywords={["start image", "first frame", "init", "conditioning"]}
            value={fpStartWeight}
            onChange={(v) => setParam("fpStartWeight", v)}
            min={0}
            max={2}
            step={0.05}
          />
          <ParamSlider
            label="End wt"
            tooltip="Pull of the end image, against the start image, on both the vision embedding and the first section's anchor latents.<br>Raise it when the clip fails to arrive at the frame you supplied; lower it when the motion snaps to the ending too early.<br><br>Default 1. Does nothing without an end image."
            keywords={["end image", "last frame", "target frame", "conditioning"]}
            value={fpEndWeight}
            onChange={(v) => setParam("fpEndWeight", v)}
            min={0}
            max={2}
            step={0.05}
          />
        </ParamGrid>
        <ParamSlider
          label="Vision wt"
          tooltip="Scales the vision-encoder embedding taken from the input image, which carries style and subject rather than exact pixels. Higher values hold the source image's look across the whole clip; lower values hand control back to the text prompt.<br><br>0 drops image guidance entirely. Default 1."
          keywords={["clip vision", "siglip", "image prompt", "style"]}
          value={fpVisionWeight}
          onChange={(v) => setParam("fpVisionWeight", v)}
          min={0}
          max={2}
          step={0.05}
        />
      </SectionLeader>

      <SectionLeader
        title="Sections"
        collapsible
        defaultCollapsed
        tooltip="FramePack builds a clip as a run of fixed-length sections. Give each one its own prompt to script motion over time, or leave them identical for one continuous action.<br>Each entry is appended to the main prompt for that section; the number of sections follows from duration, FPS, and <b><i>Window</i></b>."
      >
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
          tooltip="Latent window size, which sets how much video FramePack generates in one go: each section covers <b>window x 4 - 3</b> frames, so the default 9 produces 33-frame sections.<br>Wider windows give the sampler more temporal context and smoother motion, at a steep cost in VRAM and time per section. Narrower windows fit smaller cards but split the clip into more sections, and drift shows at each join.<br><br>Sections = duration x FPS / (window x 4). Default 9."
          keywords={["latent window", "section length", "context", "chunk"]}
          value={fpLatentWindowSize}
          onChange={(v) => setParam("fpLatentWindowSize", v)}
          min={1}
          max={33}
          step={4}
        />
        <ParamGrid>
          <ParamSlider
            label="FP shift"
            tooltip="Flow-matching timestep shift for FramePack's own sampler. Above 1 spends more of the schedule on high-noise steps, firming up structure and motion; below 1 favours the late steps and fine detail. 1 applies no shift.<br><br>Set to 0 to derive the shift from the clip's sequence length instead. Default 3."
            keywords={["flow shift", "sampler shift", "timestep", "schedule"]}
            value={fpShift}
            onChange={(v) => setParam("fpShift", v)}
            min={0}
            max={20}
            step={0.5}
          />
          <ParamSlider
            label="CFG"
            tooltip="Real classifier-free guidance. At 1 the negative prompt is never even encoded and this costs nothing; above 1 every step runs a second pass, roughly halving speed, and the negative prompt starts to bite.<br><br>FramePack normally steers with <b><i>Distilled</i></b> and leaves this at 1."
            keywords={["classifier free", "real cfg", "negative prompt", "guidance"]}
            value={fpCfgScale}
            onChange={(v) => setParam("fpCfgScale", v)}
            min={0}
            max={20}
            step={0.5}
          />
          <ParamSlider
            label="Distilled"
            tooltip="Distilled guidance scale, which is what FramePack actually steers with. It is handed to the transformer as an embedded value, so it costs nothing extra per step.<br>Higher values track the prompt harder and stiffen motion; lower values move more freely and blur.<br><br>Default 10."
            keywords={["distilled guidance", "embedded cfg", "guidance scale", "cfg"]}
            value={fpCfgDistilled}
            onChange={(v) => setParam("fpCfgDistilled", v)}
            min={0}
            max={20}
            step={0.5}
          />
          <ParamSlider
            label="Rescale"
            tooltip="Pulls the guided prediction back toward the unguided one to undo the contrast and saturation blowout that strong guidance causes. 1 rescales fully, 0 disables it.<br><br>Only does anything while <b><i>CFG</i></b> is above 1; at the default CFG of 1 there is no guided prediction to rescale, so any value here is a no-op.<br><br>Default 0."
            keywords={["cfg rescale", "guidance rescale", "oversaturation", "contrast"]}
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
          <ParamLabel
            className="text-2xs text-muted-foreground w-16 shrink-0"
            tooltip="Skip transformer steps whose output barely changes, roughly doubling speed for a small loss of fine detail and motion accuracy.<br><br>The skip threshold lives in settings. Turn this off when chasing the best quality a model can give."
          >
            TeaCache
          </ParamLabel>
          <Switch checked={fpTeacache} onCheckedChange={(v) => setParam("fpTeacache", v)} />
        </div>
        <div className="flex items-center gap-2">
          <ParamLabel
            className="text-2xs text-muted-foreground w-16 shrink-0"
            tooltip="Wrap the prompt in a rewritten video-director system prompt instead of the model's original one, which generally reads motion cues better.<br><br>Ignored when a custom system prompt is set above."
          >
            Optimized
          </ParamLabel>
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
          <ParamLabel
            className="text-2xs text-muted-foreground w-16 shrink-0"
            tooltip="Which attention backend to install when the model loads. At runtime the fastest available one wins in the order sage, flash, xformers, SDPA, so picking a slower backend here does not force it if a faster one is importable.<br><br>Changing this takes effect on the next model load."
          >
            Attention
          </ParamLabel>
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
