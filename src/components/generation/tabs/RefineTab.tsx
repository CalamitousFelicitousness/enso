import { useMemo, useCallback } from "react";
import { useGenerationStore } from "@/stores/generationStore";
import { useShallow } from "zustand/react/shallow";
import { useSamplerList, useUpscalerGroups } from "@/api/hooks/useModels";
import {
  HIRES_SIZE_MODES,
  HIRES_FIT_MODES,
  HIRES_CONTEXT_MODES,
} from "@/lib/constants";
import { ParamSlider } from "../ParamSlider";
import { SectionLeader, SectionDivider } from "@/components/ui/section-leader";
import { ParamRow, ParamGrid } from "../ParamRow";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { PromptField } from "../PromptField";
import { Combobox } from "@/components/ui/combobox";
import { SegmentedControl } from "@/components/ui/segmented-control";

const UPSCALE_SIZE_MODES = [
  { value: "0", label: "Scale" },
  { value: "1", label: "Dimensions" },
];

export function RefineTab() {
  const state = useGenerationStore(
    useShallow((s) => ({
      refinerEnabled: s.refinerEnabled,
      refinerStart: s.refinerStart,
      refinerSteps: s.refinerSteps,
      refinerPrompt: s.refinerPrompt,
      refinerNegative: s.refinerNegative,
      hiresEnabled: s.hiresEnabled,
      hiresUpscaler: s.hiresUpscaler,
      hiresScale: s.hiresScale,
      hiresSteps: s.hiresSteps,
      hiresDenoising: s.hiresDenoising,
      hiresResizeMode: s.hiresResizeMode,
      hiresSampler: s.hiresSampler,
      hiresForce: s.hiresForce,
      hiresResizeX: s.hiresResizeX,
      hiresResizeY: s.hiresResizeY,
      hiresResizeContext: s.hiresResizeContext,
      upscaleAfterEnabled: s.upscaleAfterEnabled,
      upscaleAfterUpscaler: s.upscaleAfterUpscaler,
      upscaleAfterScale: s.upscaleAfterScale,
      upscaleAfterResizeMode: s.upscaleAfterResizeMode,
      upscaleAfterWidth: s.upscaleAfterWidth,
      upscaleAfterHeight: s.upscaleAfterHeight,
    })),
  );
  const setParam = useGenerationStore((s) => s.setParam);
  const upscalerGroups = useUpscalerGroups();
  const { data: samplers } = useSamplerList();

  // Derive size mode from store: fixed dims set = "fixed", otherwise "scale"
  const sizeMode =
    state.hiresResizeX > 0 || state.hiresResizeY > 0 ? "fixed" : "scale";

  const set = useMemo(
    () => ({
      refinerEnabled: (v: boolean) => setParam("refinerEnabled", v),
      refinerStart: (v: number) => setParam("refinerStart", v),
      refinerSteps: (v: number) => setParam("refinerSteps", v),
      refinerPrompt: (v: string) => setParam("refinerPrompt", v),
      refinerNegative: (v: string) => setParam("refinerNegative", v),
      hiresEnabled: (v: boolean) => setParam("hiresEnabled", v),
      hiresResizeMode: (v: string) => setParam("hiresResizeMode", Number(v)),
      hiresScale: (v: number) => setParam("hiresScale", v),
      hiresResizeX: (v: number) => setParam("hiresResizeX", v),
      hiresResizeY: (v: number) => setParam("hiresResizeY", v),
      hiresResizeContext: (v: string) => setParam("hiresResizeContext", v),
      hiresUpscaler: (v: string) => setParam("hiresUpscaler", v),
      hiresSampler: (v: string) =>
        setParam("hiresSampler", v === "_same_" ? "" : v),
      hiresDenoising: (v: number) => setParam("hiresDenoising", v),
      hiresSteps: (v: number) => setParam("hiresSteps", v),
      hiresForce: (c: boolean | "indeterminate") => setParam("hiresForce", !!c),
      upscaleAfterEnabled: (v: boolean) => setParam("upscaleAfterEnabled", v),
      upscaleAfterUpscaler: (v: string) => setParam("upscaleAfterUpscaler", v),
      upscaleAfterScale: (v: number) => setParam("upscaleAfterScale", v),
      upscaleAfterResizeMode: (v: number) => setParam("upscaleAfterResizeMode", v),
      upscaleAfterWidth: (v: number) => setParam("upscaleAfterWidth", v),
      upscaleAfterHeight: (v: number) => setParam("upscaleAfterHeight", v),
    }),
    [setParam],
  );

  const handleSizeMode = useCallback(
    (v: string) => {
      if (v === "scale") {
        setParam("hiresResizeX", 0);
        setParam("hiresResizeY", 0);
      } else {
        const s = useGenerationStore.getState();
        const scale = s.hiresScale > 1 ? s.hiresScale : 2;
        setParam("hiresResizeX", Math.round((s.width * scale) / 8) * 8);
        setParam("hiresResizeY", Math.round((s.height * scale) / 8) * 8);
      }
    },
    [setParam],
  );

  const showContextDropdown = state.hiresResizeMode === 5;

  return (
    <div className="flex flex-col gap-3 text-sm">

      <SectionLeader
        title="Refiner"
        enableable
        enabled={state.refinerEnabled}
        onToggleEnabled={set.refinerEnabled}
        tooltip="Run a second model (refiner) partway through generation for improved quality.<br><br><b>Pipeline order:</b> runs during base generation, taking over at the specified start point.<br><br>Only useful with model architectures that have dedicated refiner checkpoints (e.g. SDXL). The refiner handles the final denoising steps using a model trained for fine detail."
      >
        <ParamGrid>
          <ParamSlider
            label="Start"
            tooltip="Refiner pass will start when base model is this much complete (set to larger than 0 and smaller than 1 to run after full base model run)"
            keywords={["refiner", "switch", "handoff"]}
            value={state.refinerStart}
            onChange={set.refinerStart}
            min={0}
            max={1}
            step={0.01}
          />
          <ParamSlider
            label="Steps"
            tooltip="Number of steps to use for refiner pass"
            keywords={["refiner"]}
            value={state.refinerSteps}
            onChange={set.refinerSteps}
            min={0}
            max={150}
          />
        </ParamGrid>

        <div className="flex flex-col gap-1">
          <Label className="text-2xs text-muted-foreground">Refiner prompt</Label>
          <PromptField
            value={state.refinerPrompt}
            onChange={set.refinerPrompt}
            placeholder="Refiner prompt (optional)"
            className="min-h-12"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-2xs text-muted-foreground">Refiner negative</Label>
          <PromptField
            value={state.refinerNegative}
            onChange={set.refinerNegative}
            placeholder="Refiner negative prompt (optional)"
            className="min-h-9"
          />
        </div>
      </SectionLeader>

      <SectionDivider />

      <SectionLeader
        title="Hires Fix"
        enableable
        enabled={state.hiresEnabled}
        onToggleEnabled={set.hiresEnabled}
        tooltip="Upscale the image and run a second diffusion pass to add detail at the higher resolution.<br><br><b>Pipeline order:</b> runs after base generation (and refiner, if enabled).<br><br>Uses GPU for a second sampling pass - slower but produces sharper detail than a pure upscale. Set <b>Force hires</b> to always run the diffusion pass even with non-latent upscalers."
      >
        <div className="flex flex-col gap-2">
          <ParamRow
            label="Upscaler"
            tooltip="Upscaler model used to enlarge the image before the hires diffusion pass."
            keywords={["hires", "model", "esrgan", "siax"]}
          >
            <Combobox
              value={state.hiresUpscaler}
              onValueChange={set.hiresUpscaler}
              groups={upscalerGroups}
              className="h-6 text-2xs"
            />
          </ParamRow>

          <ParamRow
            label="Size"
            tooltip="How the hires target resolution is determined:<br>- <b>Scale</b>: multiply base width/height by a scale factor<br>- <b>Fixed</b>: specify exact target dimensions with a fit method"
            keywords={["hires", "resolution mode"]}
          >
            <Combobox
              value={sizeMode}
              onValueChange={handleSizeMode}
              options={HIRES_SIZE_MODES}
              className="h-6 text-2xs"
            />
          </ParamRow>

          {sizeMode === "scale" ? (
            <ParamSlider
              label="Scale"
              tooltip="Multiplier for hires resolution; base width × scale = hires width."
              keywords={["hires", "upscale", "highres", "resolution"]}
              value={state.hiresScale}
              onChange={set.hiresScale}
              min={1}
              max={4}
              step={0.1}
            />
          ) : (
            <>
              <ParamRow
                label="Dims"
                tooltip="Target width and height in pixels for the hires fix output."
                keywords={["hires", "width", "height", "dimensions"]}
              >
                <div className="flex items-center gap-2">
                  <NumberInput
                    value={state.hiresResizeX}
                    onChange={set.hiresResizeX}
                    placeholder="Width"
                    step={8}
                    min={0}
                    max={8192}
                    fallback={0}
                    className="flex-1 h-6 text-2xs text-center px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-3xs text-muted-foreground">x</span>
                  <NumberInput
                    value={state.hiresResizeY}
                    onChange={set.hiresResizeY}
                    placeholder="Height"
                    step={8}
                    min={0}
                    max={8192}
                    fallback={0}
                    className="flex-1 h-6 text-2xs text-center px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </ParamRow>
              <ParamRow
                label="Fit"
                tooltip="How to adapt the image when target dimensions differ from the source aspect ratio:<br>- <b>Stretch</b>: force to exact dimensions (may distort)<br>- <b>Crop</b>: resize and center-crop to fill target<br>- <b>Fill</b>: resize to fit and pad borders<br>- <b>Outpaint</b>: extend canvas beyond image edges<br>- <b>Context aware</b>: smart resize that blends surrounding areas"
                keywords={["hires", "resize mode", "stretch", "crop", "outpaint"]}
              >
                <Combobox
                  value={String(state.hiresResizeMode)}
                  onValueChange={set.hiresResizeMode}
                  options={HIRES_FIT_MODES}
                  className="h-6 text-2xs"
                />
              </ParamRow>
              {showContextDropdown && (
                <ParamRow
                  label="Context"
                  tooltip="Method used to extend image content when Fit is set to Context aware."
                  keywords={["hires", "context aware", "outpaint"]}
                >
                  <Combobox
                    value={state.hiresResizeContext}
                    onValueChange={set.hiresResizeContext}
                    options={HIRES_CONTEXT_MODES}
                    className="h-6 text-2xs"
                  />
                </ParamRow>
              )}
            </>
          )}

          <ParamRow
            label="Sampler"
            tooltip="Sampler used for the hires diffusion pass. Defaults to the same sampler as the base pass."
            keywords={["hires", "second pass"]}
          >
            <Combobox
              value={state.hiresSampler || "_same_"}
              onValueChange={set.hiresSampler}
              options={[
                { value: "_same_", label: "Same as primary" },
                ...(samplers?.map((s) => ({
                  value: s.name,
                  label: s.name,
                })) ?? []),
              ]}
              placeholder="Same as primary"
              className="h-6 text-2xs"
            />
          </ParamRow>

          <ParamGrid>
            <ParamSlider
              label="Denoise"
              tooltip="Denoising strength for the hires pass. Lower values stay closer to the base image; higher values re-imagine more detail."
              keywords={["hires", "denoising", "strength"]}
              value={state.hiresDenoising}
              onChange={set.hiresDenoising}
              min={0}
              max={1}
              step={0.05}
            />
            <ParamSlider
              label="Steps"
              tooltip="Number of sampling steps for upscaled picture. If 0, uses same as for original"
              keywords={["hires", "highres"]}
              value={state.hiresSteps}
              onChange={set.hiresSteps}
              min={0}
              max={150}
            />
          </ParamGrid>

          <label className="flex items-center gap-1.5 text-2xs text-muted-foreground cursor-pointer">
            <Checkbox checked={state.hiresForce} onCheckedChange={set.hiresForce} />
            Force hires
          </label>
        </div>
      </SectionLeader>

      <SectionDivider />

      <SectionLeader
        title="Upscale"
        enableable
        enabled={state.upscaleAfterEnabled}
        onToggleEnabled={set.upscaleAfterEnabled}
        tooltip="Apply a pure upscaling model to the final output - no diffusion, just resize.<br><br><b>Pipeline order:</b> runs last, after hires fix (if enabled).<br><br>Fast and lightweight - uses an upscaling model (SiAX, ESRGAN, etc.) without any sampling steps. Use this alone for a quick upscale, or after hires fix to push resolution further than your GPU can handle in a single diffusion pass."
      >
        <div className="flex flex-col gap-2">
          <ParamRow
            label="Upscaler"
            tooltip="Upscaling model applied to the final output. Pure resize, no diffusion."
            keywords={["upscale", "model", "esrgan", "siax"]}
          >
            <Combobox
              value={state.upscaleAfterUpscaler}
              onValueChange={set.upscaleAfterUpscaler}
              groups={upscalerGroups}
              className="h-6 text-2xs"
            />
          </ParamRow>

          <ParamRow
            label="Size"
            tooltip="Choose between scale factor or explicit target dimensions for the final upscale."
            keywords={["upscale", "size mode"]}
          >
            <SegmentedControl
              options={UPSCALE_SIZE_MODES}
              value={String(state.upscaleAfterResizeMode)}
              onValueChange={(v) => set.upscaleAfterResizeMode(Number(v))}
              animated
            />
          </ParamRow>

          {state.upscaleAfterResizeMode === 0 ? (
            <ParamSlider
              label="Scale"
              tooltip="Multiplier applied to the final output dimensions."
              keywords={["upscale", "factor"]}
              value={state.upscaleAfterScale}
              onChange={set.upscaleAfterScale}
              min={1}
              max={8}
              step={0.5}
            />
          ) : (
            <ParamRow
              label="Dims"
              tooltip="Target width and height in pixels for the final upscale."
              keywords={["upscale", "width", "height", "dimensions"]}
            >
              <div className="flex items-center gap-2">
                <NumberInput
                  value={state.upscaleAfterWidth}
                  onChange={set.upscaleAfterWidth}
                  placeholder="Width"
                  step={8}
                  min={0}
                  max={16384}
                  fallback={0}
                  className="flex-1 h-6 text-2xs text-center px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-3xs text-muted-foreground">x</span>
                <NumberInput
                  value={state.upscaleAfterHeight}
                  onChange={set.upscaleAfterHeight}
                  placeholder="Height"
                  step={8}
                  min={0}
                  max={16384}
                  fallback={0}
                  className="flex-1 h-6 text-2xs text-center px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </ParamRow>
          )}
        </div>
      </SectionLeader>
    </div>
  );
}
