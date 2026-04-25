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
import { X } from "lucide-react";

export function DetailTab() {
  const state = useGenerationStore(
    useShallow((s) => ({
      detailerEnabled: s.detailerEnabled,
      detailerModels: s.detailerModels,
      detailerPrompt: s.detailerPrompt,
      detailerNegative: s.detailerNegative,
      detailerSteps: s.detailerSteps,
      detailerStrength: s.detailerStrength,
      detailerResolution: s.detailerResolution,
      detailerMaxDetected: s.detailerMaxDetected,
      detailerPadding: s.detailerPadding,
      detailerBlur: s.detailerBlur,
      detailerConfidence: s.detailerConfidence,
      detailerIou: s.detailerIou,
      detailerMinSize: s.detailerMinSize,
      detailerMaxSize: s.detailerMaxSize,
      detailerRenoise: s.detailerRenoise,
      detailerRenoiseEnd: s.detailerRenoiseEnd,
      detailerSegmentation: s.detailerSegmentation,
      detailerIncludeDetections: s.detailerIncludeDetections,
      detailerMerge: s.detailerMerge,
      detailerSort: s.detailerSort,
      detailerClasses: s.detailerClasses,
    })),
  );
  const setParam = useGenerationStore((s) => s.setParam);
  const { data: models } = useDetailerModels();

  const set = useMemo(
    () => ({
      detailerEnabled: (checked: boolean) =>
        setParam("detailerEnabled", checked),
      detailerPrompt: (v: string) => setParam("detailerPrompt", v),
      detailerNegative: (v: string) => setParam("detailerNegative", v),
      detailerSteps: (v: number) => setParam("detailerSteps", v),
      detailerStrength: (v: number) => setParam("detailerStrength", v),
      detailerResolution: (v: number) => setParam("detailerResolution", v),
      detailerMaxDetected: (v: number) => setParam("detailerMaxDetected", v),
      detailerPadding: (v: number) => setParam("detailerPadding", v),
      detailerBlur: (v: number) => setParam("detailerBlur", v),
      detailerConfidence: (v: number) => setParam("detailerConfidence", v),
      detailerIou: (v: number) => setParam("detailerIou", v),
      detailerMinSize: (v: number) => setParam("detailerMinSize", v),
      detailerMaxSize: (v: number) => setParam("detailerMaxSize", v),
      detailerRenoise: (v: number) => setParam("detailerRenoise", v),
      detailerRenoiseEnd: (v: number) => setParam("detailerRenoiseEnd", v),
      detailerSegmentation: (c: boolean | "indeterminate") =>
        setParam("detailerSegmentation", !!c),
      detailerIncludeDetections: (c: boolean | "indeterminate") =>
        setParam("detailerIncludeDetections", !!c),
      detailerMerge: (c: boolean | "indeterminate") =>
        setParam("detailerMerge", !!c),
      detailerSort: (c: boolean | "indeterminate") =>
        setParam("detailerSort", !!c),
      detailerClasses: (e: React.ChangeEvent<HTMLInputElement>) =>
        setParam("detailerClasses", e.target.value),
    }),
    [setParam],
  );

  const addModel = useCallback(
    (name: string) => {
      const current = useGenerationStore.getState().detailerModels;
      if (!current.includes(name)) {
        setParam("detailerModels", [...current, name]);
      }
    },
    [setParam],
  );

  const removeModel = useCallback(
    (name: string) => {
      const current = useGenerationStore.getState().detailerModels;
      setParam(
        "detailerModels",
        current.filter((m) => m !== name),
      );
    },
    [setParam],
  );

  return (
    <div className="flex flex-col gap-3 text-sm">
      <SectionLeader title="Detailer" enableable enabled={state.detailerEnabled} onToggleEnabled={set.detailerEnabled}>
          <div className="flex flex-col gap-2">
            <div data-param="models" className="flex flex-col gap-1">
              <Label className="text-2xs text-muted-foreground">Models</Label>
              <div className="flex flex-wrap gap-1 mb-1">
                {state.detailerModels.map((m) => (
                  <span
                    key={m}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-3xs bg-muted rounded"
                  >
                    {m}
                    <button
                      onClick={() => removeModel(m)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
              <Combobox
                value=""
                onValueChange={addModel}
                options={
                  models
                    ?.filter((m) => !state.detailerModels.includes(m.name))
                    .map((m) => m.name) ?? []
                }
                placeholder="Add model..."
                className="h-6 text-2xs flex-1"
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-2xs text-muted-foreground">Prompt</Label>
              <PromptField
                value={state.detailerPrompt}
                onChange={set.detailerPrompt}
                placeholder="Detailer prompt (optional)"
                className="min-h-12"
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-2xs text-muted-foreground">Negative</Label>
              <PromptField
                value={state.detailerNegative}
                onChange={set.detailerNegative}
                placeholder="Detailer negative prompt (optional)"
                className="min-h-9"
              />
            </div>
          </div>
      </SectionLeader>

      <SectionDivider />

      <div
        className={
          state.detailerEnabled ? "" : "opacity-40 pointer-events-none"
        }
      >
        <div className="flex flex-col gap-3">
          <SectionLeader title="Generation" collapsible>
            <ParamGrid>
              <ParamSlider
                label="Steps"
                tooltip="Number of steps to run for detailer process"
                keywords={["detailer", "inpaint"]}
                value={state.detailerSteps}
                onChange={set.detailerSteps}
                min={0}
                max={99}
                disabled={!state.detailerEnabled}
              />

              <ParamSlider
                label="Strength"
                tooltip="Denoising strength of detailer process"
                keywords={["detailer", "denoising"]}
                value={state.detailerStrength}
                onChange={set.detailerStrength}
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
              value={state.detailerResolution}
              onChange={set.detailerResolution}
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
                value={state.detailerConfidence}
                onChange={set.detailerConfidence}
                min={0}
                max={1}
                step={0.01}
                disabled={!state.detailerEnabled}
              />

              <ParamSlider
                label="IoU"
                tooltip="Maximum overlap between two detected items before one is discarded"
                keywords={["detailer", "overlap", "max overlap"]}
                value={state.detailerIou}
                onChange={set.detailerIou}
                min={0}
                max={1}
                step={0.01}
                disabled={!state.detailerEnabled}
              />

              <ParamSlider
                label="Min size"
                tooltip="Minimum size of detected object as percentage of overal image"
                keywords={["detailer", "minimum"]}
                value={state.detailerMinSize}
                onChange={set.detailerMinSize}
                min={0}
                max={1}
                step={0.01}
                disabled={!state.detailerEnabled}
              />

              <ParamSlider
                label="Max size"
                tooltip="Maximum size of detected object as percentage of overal image"
                keywords={["detailer", "maximum"]}
                value={state.detailerMaxSize}
                onChange={set.detailerMaxSize}
                min={0}
                max={1}
                step={0.01}
                disabled={!state.detailerEnabled}
              />

              <ParamSlider
                label="Padding"
                tooltip="Extra pixels added around each detected region before processing. Gives the model more context for seamless blending."
                keywords={["detailer", "margin"]}
                value={state.detailerPadding}
                onChange={set.detailerPadding}
                min={0}
                max={100}
                disabled={!state.detailerEnabled}
              />

              <ParamSlider
                label="Blur"
                tooltip="Blur applied to the edges of each detected region's mask. Softens transitions between the re-generated area and the surrounding image."
                keywords={["detailer", "mask", "soften"]}
                value={state.detailerBlur}
                onChange={set.detailerBlur}
                min={0}
                max={100}
                disabled={!state.detailerEnabled}
              />
            </ParamGrid>
            <ParamSlider
              label="Max detect"
              tooltip="Maximum number of detected objects to run detailer on"
              keywords={["detailer", "limit", "count", "max detected"]}
              value={state.detailerMaxDetected}
              onChange={set.detailerMaxDetected}
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
                value={state.detailerClasses}
                onChange={set.detailerClasses}
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
                  checked={state.detailerSegmentation}
                  onCheckedChange={set.detailerSegmentation}
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
                  checked={state.detailerIncludeDetections}
                  onCheckedChange={set.detailerIncludeDetections}
                  disabled={!state.detailerEnabled}
                />

                <ParamLabel className="text-2xs text-muted-foreground">
                  Include detections
                </ParamLabel>
              </label>
              <label className="flex items-center gap-1.5 text-2xs text-muted-foreground cursor-pointer">
                <Checkbox
                  checked={state.detailerMerge}
                  onCheckedChange={set.detailerMerge}
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
                  checked={state.detailerSort}
                  onCheckedChange={set.detailerSort}
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
                value={state.detailerRenoise}
                onChange={set.detailerRenoise}
                min={0.5}
                max={1.5}
                step={0.01}
                disabled={!state.detailerEnabled}
              />

              <ParamSlider
                label="End"
                tooltip="Final step when renoise is applied"
                keywords={["detailer", "renoise", "end"]}
                value={state.detailerRenoiseEnd}
                onChange={set.detailerRenoiseEnd}
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
