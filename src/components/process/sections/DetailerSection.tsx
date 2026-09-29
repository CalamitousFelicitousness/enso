import { useCallback, useMemo } from "react";
import { useDetailerModels } from "@/api/hooks/useDetailer";
import { useSamplerList } from "@/api/hooks/useModels";
import type { DetailerModelEntry, DetailerOverrides } from "@/api/types/v2";
import { DetailerModelRow } from "@/components/generation/DetailerModelRow";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { ParamRow, ParamGrid } from "@/components/generation/ParamRow";
import { PromptField } from "@/components/generation/PromptField";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { SectionLeader } from "@/components/ui/section-leader";
import { ProcessSection, CheckRow } from "./ProcessSection";
import { useProcessSection } from "./useProcessSection";

const PREDICTIONS = ["default", "epsilon", "sample", "v_prediction", "flow_prediction"];
const OPTIONS = ["low order", "thresholding", "dynamic", "rescale"];

function asEntry(ref: string | DetailerModelEntry): DetailerModelEntry {
  return typeof ref === "string" ? { name: ref } : ref;
}

export function DetailerSection() {
  const { enabled, params, applies, setEnabled, set } = useProcessSection("detailer");
  const { data: available } = useDetailerModels();
  const { data: samplers } = useSamplerList();
  const samplerNames = useMemo(
    () => ["Default", ...(samplers ?? []).map((s) => s.name).filter((n) => n !== "Default")],
    [samplers],
  );
  const entries = useMemo(() => params.models.map(asEntry), [params.models]);
  const added = useMemo(() => new Set(entries.map((e) => e.name)), [entries]);
  const d = params.defaults;

  const setDefault = useCallback(
    <K extends keyof DetailerOverrides>(key: K, value: DetailerOverrides[K]) =>
      set("defaults")({ ...params.defaults, [key]: value }),
    [params.defaults, set],
  );
  const addModel = useCallback(
    (name: string) => {
      if (!name || added.has(name)) return;
      set("models")([...entries, { name }]);
    },
    [added, entries, set],
  );
  const updateModel = useCallback(
    (index: number, next: DetailerModelEntry) =>
      set("models")(entries.map((e, i) => (i === index ? next : e))),
    [entries, set],
  );
  const removeModel = useCallback(
    (index: number) => set("models")(entries.filter((_, i) => i !== index)),
    [entries, set],
  );
  const toggleOption = useCallback(
    (name: string, on: boolean) =>
      set("options")(on ? [...params.options, name] : params.options.filter((o) => o !== name)),
    [params.options, set],
  );

  return (
    <ProcessSection
      title="Detailer"
      tooltip="Finds faces, hands or other regions and repaints each one at higher resolution with the loaded model. Needs a checkpoint loaded."
      enabled={enabled}
      onToggleEnabled={setEnabled}
      applies={applies}
      inapplicableHint="The detailer takes images."
    >
      <ParamRow
        label="Models"
        tooltip="Detectors run in this order. Leave empty to use the detailer models from Settings."
      >
        <Combobox
          value=""
          onValueChange={addModel}
          options={(available ?? []).map((m) => m.name).filter((n) => !added.has(n))}
          placeholder="Add model..."
          className="h-6 text-2xs w-full"
        />
      </ParamRow>
      {entries.length > 0 && (
        <div className="flex flex-col gap-1">
          {entries.map((entry, i) => (
            <DetailerModelRow
              key={`${entry.name}-${i}`}
              entry={entry}
              defaults={d}
              onUpdate={(next) => updateModel(i, next)}
              onRemove={() => removeModel(i)}
              disabled={!enabled}
            />
          ))}
        </div>
      )}
      <SectionLeader title="Prompt" level={1} collapsible>
        <PromptField
          value={d.prompt ?? ""}
          onChange={(v) => setDefault("prompt", v)}
          placeholder="Detailer prompt, empty for none"
          className="min-h-12"
        />
        <PromptField
          value={d.negative ?? ""}
          onChange={(v) => setDefault("negative", v)}
          placeholder="Detailer negative prompt, empty for none"
          className="min-h-9"
        />
        <ParamRow
          label="Classes"
          tooltip="Comma-separated class names to keep from a multi-class detector, or instructions for a vision-language detector. Empty keeps every detection."
        >
          <Input
            value={d.classes ?? ""}
            onChange={(e) => setDefault("classes", e.target.value)}
            placeholder="e.g. person, face"
            className="h-6 text-2xs px-2"
          />
        </ParamRow>
      </SectionLeader>
      <SectionLeader title="Generation" level={1} collapsible>
        <ParamGrid>
          <ParamSlider
            label="Steps"
            tooltip="Sampling steps for each repainted region."
            value={d.steps ?? 10}
            onChange={(v) => setDefault("steps", v)}
            min={0}
            max={99}
          />
          <ParamSlider
            label="Strength"
            tooltip="How far each region is repainted. 0.2 to 0.5 fixes distortions and keeps identity; above 0.7 the region drifts from the original."
            value={d.strength ?? 0.3}
            onChange={(v) => setDefault("strength", v)}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
          />
        </ParamGrid>
        <ParamSlider
          label="Resolution"
          tooltip="Each region is cropped and resized to this before repainting. Match the model's native size: 1024 for SDXL, SD3 and Flux, 512 for SD 1.5."
          value={d.resolution ?? 1024}
          onChange={(v) => setDefault("resolution", v)}
          min={256}
          max={4096}
          step={8}
        />
      </SectionLeader>
      <SectionLeader title="Sampler" level={1} collapsible defaultCollapsed>
        <ParamGrid>
          <ParamRow
            label="Sampler"
            tooltip="Sampler for the repaint pass. Default keeps the model's own scheduler, and the settings below only apply with a named sampler."
          >
            <Combobox
              value={params.sampler}
              onValueChange={set("sampler")}
              options={samplerNames}
              className="h-6 text-2xs w-full"
            />
          </ParamRow>
          <ParamRow
            label="Prediction"
            tooltip="Scheduler prediction type override; default keeps the model's."
          >
            <Combobox
              value={params.prediction}
              onValueChange={set("prediction")}
              options={PREDICTIONS}
              className="h-6 text-2xs w-full"
            />
          </ParamRow>
        </ParamGrid>
        <ParamGrid>
          <ParamSlider
            label="Flow shift"
            tooltip="Timestep shift for flow models during the repaint pass."
            value={params.shift}
            onChange={set("shift")}
            min={0}
            max={10}
            step={0.1}
            decimals={1}
          />
          <ParamSlider
            label="Guidance scale"
            tooltip="Prompt adherence for the repaint pass."
            value={params.cfg_scale}
            onChange={set("cfg_scale")}
            min={0}
            max={30}
            step={0.1}
            decimals={1}
          />
        </ParamGrid>
        <div className="grid grid-cols-2 gap-1">
          {OPTIONS.map((name) => (
            <CheckRow
              key={name}
              label={name}
              checked={params.options.includes(name)}
              onCheckedChange={(on) => toggleOption(name, on)}
            />
          ))}
        </div>
        <ParamRow label="Seed" tooltip="-1 picks a random seed for the repaint passes.">
          <NumberInput value={params.seed} onChange={set("seed")} min={-1} step={1} />
        </ParamRow>
      </SectionLeader>
      <SectionLeader title="Detection" level={1} collapsible defaultCollapsed>
        <ParamGrid>
          <ParamSlider
            label="Confidence"
            tooltip="Minimum detection score to keep a region. Higher drops weak detections."
            value={d.conf ?? 0.6}
            onChange={(v) => setDefault("conf", v)}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
          />
          <ParamSlider
            label="IoU"
            tooltip="Overlap above which two detections count as the same subject and the weaker is dropped."
            value={d.iou ?? 0.5}
            onChange={(v) => setDefault("iou", v)}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
          />
          <ParamSlider
            label="Min size"
            tooltip="Smallest region to repaint, as a fraction of the shorter edge. 0 keeps everything."
            value={d.min_size ?? 0}
            onChange={(v) => setDefault("min_size", v)}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
          />
          <ParamSlider
            label="Max size"
            tooltip="Largest region to repaint, as a fraction of the shorter edge. 1 keeps everything."
            value={d.max_size ?? 1}
            onChange={(v) => setDefault("max_size", v)}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
          />
          <ParamSlider
            label="Padding"
            tooltip="Pixels of context around each region so the repaint blends with its surroundings."
            value={d.padding ?? 20}
            onChange={(v) => setDefault("padding", v)}
            min={0}
            max={100}
          />
          <ParamSlider
            label="Blur"
            tooltip="Softens the mask edge so the repainted region fades in instead of cutting hard."
            value={d.blur ?? 10}
            onChange={(v) => setDefault("blur", v)}
            min={0}
            max={100}
          />
        </ParamGrid>
        <ParamSlider
          label="Max detect"
          tooltip="Regions repainted per detector, strongest first."
          value={d.max ?? 2}
          onChange={(v) => setDefault("max", v)}
          min={1}
          max={10}
        />
        <div className="grid grid-cols-2 gap-1">
          <CheckRow
            label="Segmentation"
            checked={d.segmentation ?? false}
            onCheckedChange={(v) => setDefault("segmentation", v)}
            title="Use the detector's segmentation mask instead of its bounding box"
          />
          <CheckRow
            label="Include detections"
            checked={d.include_detections ?? false}
            onCheckedChange={(v) => setDefault("include_detections", v)}
            title="Also return an annotated image showing what was detected"
          />
          <CheckRow
            label="Merge"
            checked={d.merge ?? false}
            onCheckedChange={(v) => setDefault("merge", v)}
            title="Repaint all of a detector's regions in one pass"
          />
          <CheckRow
            label="Sort"
            checked={d.sort ?? false}
            onCheckedChange={(v) => setDefault("sort", v)}
            title="Order regions by score before applying the cap"
          />
        </div>
        <ParamGrid>
          <ParamSlider
            label="Renoise"
            tooltip="Step size multiplier for the repaint pass. Below 1 refines gently, above 1 resamples harder."
            value={d.sigma_adjust ?? 1}
            onChange={(v) => setDefault("sigma_adjust", v)}
            min={0.5}
            max={1.5}
            step={0.01}
            decimals={2}
          />
          <ParamSlider
            label="Renoise end"
            tooltip="How far into the repaint pass Renoise stays active, from 0 (first step only) to 1 (whole pass)."
            value={d.sigma_adjust_max ?? 1}
            onChange={(v) => setDefault("sigma_adjust_max", v)}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
          />
        </ParamGrid>
      </SectionLeader>
    </ProcessSection>
  );
}
