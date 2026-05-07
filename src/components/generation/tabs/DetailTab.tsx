import { useMemo, useCallback } from "react";
import { useGenerationStore } from "@/stores/generationStore";
import { useShallow } from "zustand/react/shallow";
import { useDetailerModels } from "@/api/hooks/useDetailer";
import { ParamSlider } from "../ParamSlider";

import { ParamRow, ParamGrid } from "../ParamRow";
import { getParamHelp } from "@/data/parameterHelp";
import { SectionLeader, SectionDivider } from "@/components/ui/section-leader";
import { Checkbox } from "@/components/ui/checkbox";
import { ParamLabel } from "../ParamLabel";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PromptField } from "../PromptField";
import { Combobox } from "@/components/ui/combobox";
import { DetailerModelRow } from "../DetailerModelRow";
import type { DetailerOverrides, DetailerModelEntry } from "@/api/types/v2";

/** Helper: update one field on detailerDefaults via setParam.
 *
 * The defaults block is a single store key, so we read-modify-write the
 * whole object. Each setter is a curried (key) => (value) => mutate.
 */
function makeDefaultsSetters(
  defaults: DetailerOverrides,
  setParam: ReturnType<typeof useGenerationStore.getState>["setParam"],
) {
  function setDefault<K extends keyof DetailerOverrides>(key: K, value: DetailerOverrides[K]) {
    setParam("detailerDefaults", { ...defaults, [key]: value });
  }
  return setDefault;
}

export function DetailTab() {
  const state = useGenerationStore(
    useShallow((s) => ({
      detailerEnabled: s.detailerEnabled,
      detailerOnly: s.detailerOnly,
      detailerDefaults: s.detailerDefaults,
      detailerModels: s.detailerModels,
    })),
  );
  const setParam = useGenerationStore((s) => s.setParam);
  const { data: models } = useDetailerModels();

  const setDefault = useMemo(
    () => makeDefaultsSetters(state.detailerDefaults, setParam),
    [state.detailerDefaults, setParam],
  );

  const set = useMemo(
    () => ({
      detailerEnabled: (checked: boolean) => setParam("detailerEnabled", checked),
      detailerOnly: (c: boolean | "indeterminate") => setParam("detailerOnly", !!c),
      defaultPrompt: (v: string) => setDefault("prompt", v),
      defaultNegative: (v: string) => setDefault("negative", v),
      defaultSteps: (v: number) => setDefault("steps", v),
      defaultStrength: (v: number) => setDefault("strength", v),
      defaultResolution: (v: number) => setDefault("resolution", v),
      defaultMaxDetected: (v: number) => setDefault("max", v),
      defaultPadding: (v: number) => setDefault("padding", v),
      defaultBlur: (v: number) => setDefault("blur", v),
      defaultConfidence: (v: number) => setDefault("conf", v),
      defaultIou: (v: number) => setDefault("iou", v),
      defaultMinSize: (v: number) => setDefault("min_size", v),
      defaultMaxSize: (v: number) => setDefault("max_size", v),
      defaultRenoise: (v: number) => setDefault("sigma_adjust", v),
      defaultRenoiseEnd: (v: number) => setDefault("sigma_adjust_max", v),
      defaultSegmentation: (c: boolean | "indeterminate") => setDefault("segmentation", !!c),
      defaultIncludeDetections: (c: boolean | "indeterminate") =>
        setDefault("include_detections", !!c),
      defaultMerge: (c: boolean | "indeterminate") => setDefault("merge", !!c),
      defaultSort: (c: boolean | "indeterminate") => setDefault("sort", !!c),
      defaultClasses: (e: React.ChangeEvent<HTMLInputElement>) =>
        setDefault("classes", e.target.value),
    }),
    [setParam, setDefault],
  );

  const addModel = useCallback(
    (name: string) => {
      const current = useGenerationStore.getState().detailerModels;
      if (!current.some((m) => m.name === name)) {
        setParam("detailerModels", [...current, { name }]);
      }
    },
    [setParam],
  );

  const removeModelAt = useCallback(
    (index: number) => {
      const current = useGenerationStore.getState().detailerModels;
      setParam(
        "detailerModels",
        current.filter((_, i) => i !== index),
      );
    },
    [setParam],
  );

  const updateModelAt = useCallback(
    (index: number, next: DetailerModelEntry) => {
      const current = useGenerationStore.getState().detailerModels;
      setParam(
        "detailerModels",
        current.map((m, i) => (i === index ? next : m)),
      );
    },
    [setParam],
  );

  // String-set for already-added model names (used to filter the combobox)
  const addedNames = useMemo(
    () => new Set(state.detailerModels.map((m) => m.name)),
    [state.detailerModels],
  );

  // Pull defaults values with safe fallbacks for the global (non-inheritable) sliders
  const d = state.detailerDefaults;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <SectionLeader
        title="Detailer"
        enableable
        enabled={state.detailerEnabled}
        onToggleEnabled={set.detailerEnabled}
      >
        <div className="flex flex-col gap-2">
          <label
            data-param="detail only"
            className="flex items-center gap-1.5 text-2xs text-muted-foreground cursor-pointer"
          >
            <Checkbox
              checked={state.detailerOnly}
              onCheckedChange={set.detailerOnly}
              disabled={!state.detailerEnabled}
            />
            <ParamLabel
              className="text-2xs text-muted-foreground"
              tooltip="Skip the main generation step and run only the detailer on the input image. Requires an image on the canvas. Equivalent to denoise=0 + detailer in SD.Next."
            >
              Detail only
            </ParamLabel>
          </label>

          <div data-param="models" className="flex flex-col gap-1">
            <Label className="text-2xs text-muted-foreground">Models</Label>
            <Combobox
              value=""
              onValueChange={addModel}
              options={models?.filter((m) => !addedNames.has(m.name)).map((m) => m.name) ?? []}
              placeholder="Add model..."
              className="h-6 text-2xs flex-1"
            />
          </div>
        </div>
      </SectionLeader>

      <SectionDivider />

      <div className={state.detailerEnabled ? "" : "opacity-40 pointer-events-none"}>
        <div className="flex flex-col gap-3">
          {/* Per-model rows: collapsed by default; click to expand and override per detector */}
          {state.detailerModels.length > 0 && (
            <SectionLeader title="Per-model overrides" collapsible>
              <div className="flex flex-col gap-1">
                {state.detailerModels.map((entry, i) => (
                  <DetailerModelRow
                    key={`${entry.name}-${i}`}
                    entry={entry}
                    defaults={d}
                    onUpdate={(next) => updateModelAt(i, next)}
                    onRemove={() => removeModelAt(i)}
                    disabled={!state.detailerEnabled}
                  />
                ))}
              </div>
            </SectionLeader>
          )}

          {state.detailerModels.length > 0 && <SectionDivider />}

          {/* Defaults: applied to every detector unless overridden in the row above */}
          <SectionLeader title="Defaults" collapsible>
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-2xs text-muted-foreground">Prompt</Label>
                <PromptField
                  value={d.prompt ?? ""}
                  onChange={set.defaultPrompt}
                  placeholder="Detailer prompt (optional)"
                  className="min-h-12"
                />
              </div>

              <div className="flex flex-col gap-1">
                <Label className="text-2xs text-muted-foreground">Negative</Label>
                <PromptField
                  value={d.negative ?? ""}
                  onChange={set.defaultNegative}
                  placeholder="Detailer negative prompt (optional)"
                  className="min-h-9"
                />
              </div>
            </div>
          </SectionLeader>

          <SectionDivider />

          <SectionLeader title="Generation" collapsible>
            <ParamGrid>
              <ParamSlider
                label="Steps"
                tooltip="Number of steps to run for detailer process"
                keywords={["detailer", "inpaint"]}
                value={d.steps ?? 10}
                onChange={set.defaultSteps}
                min={0}
                max={99}
                disabled={!state.detailerEnabled}
              />
              <ParamSlider
                label="Strength"
                tooltip="Denoising strength of detailer process"
                keywords={["detailer", "denoising"]}
                value={d.strength ?? 0.3}
                onChange={set.defaultStrength}
                min={0}
                max={1}
                step={0.01}
                disabled={!state.detailerEnabled}
              />
            </ParamGrid>
            <ParamSlider
              label="Resolution"
              tooltip="Resolution at which each detected region is re-generated. Higher values capture more detail but take longer."
              keywords={["detailer", "size"]}
              value={d.resolution ?? 1024}
              onChange={set.defaultResolution}
              min={256}
              max={4096}
              step={8}
              disabled={!state.detailerEnabled}
            />
          </SectionLeader>

          <SectionDivider />

          <SectionLeader title="Detection" collapsible defaultCollapsed>
            <ParamGrid>
              <ParamSlider
                label="Confidence"
                tooltip="Minimum confidence in detected item"
                keywords={["detailer", "threshold", "min confidence"]}
                value={d.conf ?? 0.6}
                onChange={set.defaultConfidence}
                min={0}
                max={1}
                step={0.01}
                disabled={!state.detailerEnabled}
              />
              <ParamSlider
                label="IoU"
                tooltip="Maximum overlap between two detected items before one is discarded"
                keywords={["detailer", "overlap", "max overlap"]}
                value={d.iou ?? 0.5}
                onChange={set.defaultIou}
                min={0}
                max={1}
                step={0.01}
                disabled={!state.detailerEnabled}
              />
              <ParamSlider
                label="Min size"
                tooltip="Minimum size of detected object as percentage of overal image"
                keywords={["detailer", "minimum"]}
                value={d.min_size ?? 0.0}
                onChange={set.defaultMinSize}
                min={0}
                max={1}
                step={0.01}
                disabled={!state.detailerEnabled}
              />
              <ParamSlider
                label="Max size"
                tooltip="Maximum size of detected object as percentage of overal image"
                keywords={["detailer", "maximum"]}
                value={d.max_size ?? 1.0}
                onChange={set.defaultMaxSize}
                min={0}
                max={1}
                step={0.01}
                disabled={!state.detailerEnabled}
              />
              <ParamSlider
                label="Padding"
                tooltip="Extra pixels added around each detected region before processing. Gives the model more context for seamless blending."
                keywords={["detailer", "margin"]}
                value={d.padding ?? 20}
                onChange={set.defaultPadding}
                min={0}
                max={100}
                disabled={!state.detailerEnabled}
              />
              <ParamSlider
                label="Blur"
                tooltip="Blur applied to the edges of each detected region's mask. Softens transitions between the re-generated area and the surrounding image."
                keywords={["detailer", "mask", "soften"]}
                value={d.blur ?? 10}
                onChange={set.defaultBlur}
                min={0}
                max={100}
                disabled={!state.detailerEnabled}
              />
            </ParamGrid>
            <ParamSlider
              label="Max detect"
              tooltip="Maximum number of detected objects to run detailer on"
              keywords={["detailer", "limit", "count", "max detected"]}
              value={d.max ?? 2}
              onChange={set.defaultMaxDetected}
              min={1}
              max={10}
              disabled={!state.detailerEnabled}
            />
            <ParamRow
              label="Classes"
              tooltip="Specify specific classes to use if selected detailer model is a multi-class model"
              keywords={["detailer", "person", "face"]}
            >
              <Input
                value={d.classes ?? ""}
                onChange={set.defaultClasses}
                placeholder="e.g. person, face"
                className="h-6 text-2xs px-2"
                disabled={!state.detailerEnabled}
              />
            </ParamRow>
          </SectionLeader>

          <SectionDivider />

          <SectionLeader title="Options" collapsible defaultCollapsed>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-1.5 text-2xs text-muted-foreground cursor-pointer">
                <Checkbox
                  checked={d.segmentation ?? false}
                  onCheckedChange={set.defaultSegmentation}
                  disabled={!state.detailerEnabled}
                />
                <ParamLabel
                  className="text-2xs text-muted-foreground"
                  tooltip={getParamHelp("use segmentation")}
                >
                  Segmentation
                </ParamLabel>
              </label>
              <label className="flex items-center gap-1.5 text-2xs text-muted-foreground cursor-pointer">
                <Checkbox
                  checked={d.include_detections ?? false}
                  onCheckedChange={set.defaultIncludeDetections}
                  disabled={!state.detailerEnabled}
                />
                <ParamLabel className="text-2xs text-muted-foreground">
                  Include detections
                </ParamLabel>
              </label>
              <label className="flex items-center gap-1.5 text-2xs text-muted-foreground cursor-pointer">
                <Checkbox
                  checked={d.merge ?? false}
                  onCheckedChange={set.defaultMerge}
                  disabled={!state.detailerEnabled}
                />
                <ParamLabel
                  className="text-2xs text-muted-foreground"
                  tooltip={getParamHelp("merge detailers")}
                >
                  Merge
                </ParamLabel>
              </label>
              <label className="flex items-center gap-1.5 text-2xs text-muted-foreground cursor-pointer">
                <Checkbox
                  checked={d.sort ?? false}
                  onCheckedChange={set.defaultSort}
                  disabled={!state.detailerEnabled}
                />
                <ParamLabel
                  className="text-2xs text-muted-foreground"
                  tooltip={getParamHelp("sort detections")}
                >
                  Sort
                </ParamLabel>
              </label>
            </div>
          </SectionLeader>

          <SectionDivider />

          <SectionLeader title="Noise" collapsible defaultCollapsed>
            <ParamGrid>
              <ParamSlider
                label="Renoise"
                tooltip="Apply additional noise during detailing"
                keywords={["detailer", "noise"]}
                value={d.sigma_adjust ?? 1.0}
                onChange={set.defaultRenoise}
                min={0.5}
                max={1.5}
                step={0.01}
                disabled={!state.detailerEnabled}
              />
              <ParamSlider
                label="End"
                tooltip="Final step when renoise is applied"
                keywords={["detailer", "renoise", "end"]}
                value={d.sigma_adjust_max ?? 1.0}
                onChange={set.defaultRenoiseEnd}
                min={0}
                max={1}
                step={0.01}
                disabled={!state.detailerEnabled}
              />
            </ParamGrid>
          </SectionLeader>
        </div>
      </div>
    </div>
  );
}
