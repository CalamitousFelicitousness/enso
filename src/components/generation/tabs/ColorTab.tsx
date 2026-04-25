import { useCallback, useMemo, useRef } from "react";
import { useGenerationStore } from "@/stores/generationStore";
import { useShallow } from "zustand/react/shallow";
import { ParamSlider } from "../ParamSlider";

import { ParamGrid } from "../ParamRow";
import { ParamLabel } from "../ParamLabel";
import { getParamHelp } from "@/data/parameterHelp";
import { Switch } from "@/components/ui/switch";
import { SectionLeader, SectionDivider } from "@/components/ui/section-leader";

import { Combobox } from "@/components/ui/combobox";
import { ColorPicker } from "@/components/ui/color-picker";
import { Button } from "@/components/ui/button";
import { Upload, X } from "lucide-react";
import { uploadFile } from "@/lib/upload";

export function ColorTab() {
  const state = useGenerationStore(
    useShallow((s) => ({
      colorCorrectionEnabled: s.colorCorrectionEnabled,
      colorCorrectionMethod: s.colorCorrectionMethod,
      hdrMode: s.hdrMode,
      hdrBrightness: s.hdrBrightness,
      hdrSharpen: s.hdrSharpen,
      hdrColor: s.hdrColor,
      hdrClamp: s.hdrClamp,
      hdrBoundary: s.hdrBoundary,
      hdrThreshold: s.hdrThreshold,
      hdrMaximize: s.hdrMaximize,
      hdrMaxCenter: s.hdrMaxCenter,
      hdrMaxBoundary: s.hdrMaxBoundary,
      hdrColorPicker: s.hdrColorPicker,
      hdrTintRatio: s.hdrTintRatio,
      hdrApplyHires: s.hdrApplyHires,
      gradingBrightness: s.gradingBrightness,
      gradingContrast: s.gradingContrast,
      gradingSaturation: s.gradingSaturation,
      gradingHue: s.gradingHue,
      gradingGamma: s.gradingGamma,
      gradingSharpness: s.gradingSharpness,
      gradingColorTemp: s.gradingColorTemp,
      gradingShadows: s.gradingShadows,
      gradingMidtones: s.gradingMidtones,
      gradingHighlights: s.gradingHighlights,
      gradingClaheClip: s.gradingClaheClip,
      gradingClaheGrid: s.gradingClaheGrid,
      gradingShadowsTint: s.gradingShadowsTint,
      gradingHighlightsTint: s.gradingHighlightsTint,
      gradingSplitToneBalance: s.gradingSplitToneBalance,
      gradingVignette: s.gradingVignette,
      gradingGrain: s.gradingGrain,
      gradingLutFile: s.gradingLutFile,
      gradingLutStrength: s.gradingLutStrength,
    })),
  );
  const setParam = useGenerationStore((s) => s.setParam);

  const set = useMemo(
    () => ({
      colorCorrectionEnabled: (checked: boolean) =>
        setParam("colorCorrectionEnabled", checked),
      colorCorrectionMethod: (v: string) =>
        setParam("colorCorrectionMethod", v),
      hdrMode: (v: string) => setParam("hdrMode", Number(v)),
      hdrBrightness: (v: number) => setParam("hdrBrightness", v),
      hdrSharpen: (v: number) => setParam("hdrSharpen", v),
      hdrColor: (v: number) => setParam("hdrColor", v),
      hdrClamp: (checked: boolean) => setParam("hdrClamp", checked),
      hdrBoundary: (v: number) => setParam("hdrBoundary", v),
      hdrThreshold: (v: number) => setParam("hdrThreshold", v),
      hdrMaximize: (checked: boolean) => setParam("hdrMaximize", checked),
      hdrMaxCenter: (v: number) => setParam("hdrMaxCenter", v),
      hdrMaxBoundary: (v: number) => setParam("hdrMaxBoundary", v),
      hdrColorPicker: (v: string) => setParam("hdrColorPicker", v),
      hdrTintRatio: (v: number) => setParam("hdrTintRatio", v),
      hdrApplyHires: (checked: boolean) => setParam("hdrApplyHires", checked),
      gradingBrightness: (v: number) => setParam("gradingBrightness", v),
      gradingContrast: (v: number) => setParam("gradingContrast", v),
      gradingSaturation: (v: number) => setParam("gradingSaturation", v),
      gradingHue: (v: number) => setParam("gradingHue", v),
      gradingGamma: (v: number) => setParam("gradingGamma", v),
      gradingSharpness: (v: number) => setParam("gradingSharpness", v),
      gradingColorTemp: (v: number) => setParam("gradingColorTemp", v),
      gradingShadows: (v: number) => setParam("gradingShadows", v),
      gradingMidtones: (v: number) => setParam("gradingMidtones", v),
      gradingHighlights: (v: number) => setParam("gradingHighlights", v),
      gradingClaheClip: (v: number) => setParam("gradingClaheClip", v),
      gradingClaheGrid: (v: number) => setParam("gradingClaheGrid", v),
      gradingShadowsTint: (v: string) => setParam("gradingShadowsTint", v),
      gradingHighlightsTint: (v: string) =>
        setParam("gradingHighlightsTint", v),
      gradingSplitToneBalance: (v: number) =>
        setParam("gradingSplitToneBalance", v),
      gradingVignette: (v: number) => setParam("gradingVignette", v),
      gradingGrain: (v: number) => setParam("gradingGrain", v),
      gradingLutStrength: (v: number) => setParam("gradingLutStrength", v),
    }),
    [setParam],
  );

  const lutInputRef = useRef<HTMLInputElement>(null);
  const lutFileName = state.gradingLutFile
    ? (state.gradingLutFile.split("/").pop() ?? "")
    : "";
  const hasLut = !!state.gradingLutFile;

  const handleLutFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const ref = await uploadFile(file);
      setParam("gradingLutFile", ref);
    },
    [setParam],
  );

  const clearLut = useCallback(() => {
    setParam("gradingLutFile", "");
  }, [setParam]);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <SectionLeader title="Color Correction" enableable enabled={state.colorCorrectionEnabled} onToggleEnabled={set.colorCorrectionEnabled}>
        <div data-param="method" className="flex items-center gap-2">
          <ParamLabel
            className="text-2xs text-muted-foreground w-16 flex-shrink-0"
            tooltip={getParamHelp("color correction method")}
          >
            Method
          </ParamLabel>
          <Combobox
            value={state.colorCorrectionMethod}
            onValueChange={set.colorCorrectionMethod}
            options={[
              { value: "histogram", label: "Histogram" },
              { value: "wavelet", label: "Wavelet" },
              { value: "adain", label: "AdaIN" },
            ]}
            className="h-6 text-2xs flex-1"
          />
        </div>
      </SectionLeader>

      <SectionDivider />

      <SectionLeader title="Latent Corrections" collapsible defaultCollapsed>
        <div className="flex items-center gap-2">
          <ParamLabel
            className="text-2xs text-muted-foreground w-16 flex-shrink-0"
            tooltip={getParamHelp("latent mode")}
          >
            Mode
          </ParamLabel>
          <Combobox
            value={String(state.hdrMode)}
            onValueChange={set.hdrMode}
            options={[
              { value: "0", label: "Relative values" },
              { value: "1", label: "Absolute values" },
            ]}
            className="h-6 text-2xs flex-1"
          />
        </div>

        <ParamGrid>
          <ParamSlider
            label="Brightness"
            keywords={["latent", "hdr", "luminance"]}
            value={state.hdrBrightness}
            onChange={set.hdrBrightness}
            min={-1}
            max={1}
            step={0.05}
            tooltip="Additive offset to channel 0 (luminance) during late denoising (timestep &lt; 200).<br><br><b>Relative mode:</b> adds the value directly - e.g. 0.1 shifts the luminance mean up by ~0.1 in latent space (typical range ±3).<br><b>Absolute mode:</b> first subtracts the channel mean, then adds the offset - centering luminance before shifting.<br><br>The total offset is spread evenly across all active steps in the range, so the slider value represents the cumulative shift."
          />

          <ParamSlider
            label="Sharpen"
            keywords={["latent", "hdr", "sharpen"]}
            value={state.hdrSharpen}
            onChange={set.hdrSharpen}
            min={-1}
            max={1}
            step={0.05}
            tooltip="Sharpens or softens the latent during late denoising (timestep &lt; 350) using a 3×3 convolution kernel.<br><br>The per-step strength scales with the timestep: stronger early, weaker late. Positive values sharpen edges, negative values blur. Output is soft-clamped to prevent artifacts."
          />
        </ParamGrid>
        <ParamSlider
          label="Color"
          keywords={["latent", "saturation", "hdr"]}
          value={state.hdrColor}
          onChange={set.hdrColor}
          min={0}
          max={4}
          step={0.1}
          tooltip="Centers chrominance channels (1-3) during mid-stage denoising (timestep 600-900).<br><br>Each channel's spatial mean is subtracted, scaled by this value. At 1.0, the mean is fully removed (zero-centering). At 4.0 (max), it over-corrects - useful for desaturating color casts.<br><br>The total correction is spread evenly across all active steps in the range."
        />

        <div className="flex items-center gap-2">
          <ParamLabel
            className="text-2xs text-muted-foreground w-16 flex-shrink-0"
            tooltip={getParamHelp("hdr clamp")}
          >
            Clamp
          </ParamLabel>
          <Switch checked={state.hdrClamp} onCheckedChange={set.hdrClamp} />
        </div>
        <ParamGrid>
          <ParamSlider
            label="Range"
            keywords={["latent", "clamp", "hdr"]}
            value={state.hdrBoundary}
            onChange={set.hdrBoundary}
            min={0}
            max={10}
            step={0.1}
            disabled={!state.hdrClamp}
            tooltip="The boundary defining the &quot;normal&quot; range for latent values. Clamping targets values beyond <b>Threshold × Range</b>.<br><br>Default 4.0 covers most of the typical latent distribution. Lower values clamp more of the distribution; higher values only affect extreme outliers."
          />

          <ParamSlider
            label="Threshold"
            keywords={["latent", "clamp"]}
            value={state.hdrThreshold}
            onChange={set.hdrThreshold}
            min={0}
            max={1}
            step={0.01}
            disabled={!state.hdrClamp}
            tooltip="Fraction of the Range at which soft clamping begins. At 0.95 (default), values beyond 95% of the boundary are smoothly compressed.<br><br>Lower = more aggressive clamping. Higher = only extreme outliers affected."
          />
        </ParamGrid>

        <div className="flex items-center gap-2">
          <ParamLabel
            className="text-2xs text-muted-foreground w-16 flex-shrink-0"
            tooltip={getParamHelp("hdr maximize")}
          >
            Maximize
          </ParamLabel>
          <Switch
            checked={state.hdrMaximize}
            onCheckedChange={set.hdrMaximize}
          />
        </div>
        <ParamGrid>
          <ParamSlider
            label="Center"
            keywords={["hdr", "maximize", "centering"]}
            value={state.hdrMaxCenter}
            onChange={set.hdrMaxCenter}
            min={0}
            max={2}
            step={0.1}
            disabled={!state.hdrMaximize}
            tooltip="How strongly each channel is centered before maximizing.<br><br>At 0 = no centering. At 1.0 = each channel's mean is fully subtracted. Higher values over-center, which can invert subtle color biases."
          />

          <ParamSlider
            label="Max range"
            keywords={["hdr", "maximize", "dynamic range"]}
            value={state.hdrMaxBoundary}
            onChange={set.hdrMaxBoundary}
            min={0.5}
            max={2}
            step={0.1}
            disabled={!state.hdrMaximize}
            tooltip="Target dynamic range after normalization, as a multiplier of the default boundary (4.0).<br><br>At 1.0 = peak latent value reaches ±4. Below 1.0 = compressed range (lower contrast). Above 1.0 = expanded range (higher contrast)."
          />
        </ParamGrid>

        <ColorPicker
          label="Tint color"
          value={state.hdrColorPicker}
          onChange={set.hdrColorPicker}
        />

        <ParamSlider
          label="Tint strength"
          tooltip="Strength of the tint color applied to the latent during HDR correction. Negative values invert toward the complementary color."
          keywords={["tint", "color", "latent", "hdr"]}
          value={state.hdrTintRatio}
          onChange={set.hdrTintRatio}
          min={-1}
          max={1}
          step={0.05}
        />

        <div className="flex items-center gap-2">
          <ParamLabel
            className="text-2xs text-muted-foreground w-16 flex-shrink-0"
            tooltip={getParamHelp("apply to hires")}
          >
            Apply to hires
          </ParamLabel>
          <Switch
            checked={state.hdrApplyHires}
            onCheckedChange={set.hdrApplyHires}
          />
        </div>
      </SectionLeader>

      <SectionDivider />

      <SectionLeader title="Basic" collapsible defaultCollapsed>
        <ParamGrid>
          <ParamSlider
            label="Brightness"
            keywords={["grading", "exposure", "luminance"]}
            value={state.gradingBrightness}
            onChange={set.gradingBrightness}
            min={-1}
            max={1}
            step={0.05}
            tooltip="Adjusts overall image brightness after generation. Positive values lighten, negative values darken. Applied as a pixel-level adjustment on the decoded image."
          />

          <ParamSlider
            label="Contrast"
            keywords={["grading"]}
            value={state.gradingContrast}
            onChange={set.gradingContrast}
            min={-1}
            max={1}
            step={0.05}
            tooltip="Adjusts the difference between light and dark areas. Positive values increase contrast, negative values flatten the tonal range. 0 leaves the image unchanged."
          />

          <ParamSlider
            label="Saturation"
            keywords={["grading", "vibrance"]}
            value={state.gradingSaturation}
            onChange={set.gradingSaturation}
            min={-1}
            max={1}
            step={0.05}
            tooltip="Adjusts color intensity. Positive values make colors more vivid, negative values desaturate toward grayscale. 0 leaves the image unchanged."
          />

          <ParamSlider
            label="Hue"
            keywords={["grading", "color shift"]}
            value={state.gradingHue}
            onChange={set.gradingHue}
            min={0}
            max={1}
            step={0.05}
            tooltip="Rotates the entire color spectrum. 0 and 1 leave colors unchanged, 0.5 shifts all hues by 180 degrees (complementary colors). Useful for creative color shifts."
          />

          <ParamSlider
            label="Gamma"
            keywords={["grading", "midtones"]}
            value={state.gradingGamma}
            onChange={set.gradingGamma}
            min={0.1}
            max={10}
            step={0.1}
            tooltip="Applies a non-linear brightness curve. Values below 1.0 brighten midtones and shadows, values above 1.0 darken them. Default is 1.0 (no change)."
          />

          <ParamSlider
            label="Sharpness"
            keywords={["grading", "sharpen", "detail"]}
            value={state.gradingSharpness}
            onChange={set.gradingSharpness}
            min={0}
            max={2}
            step={0.05}
            tooltip="Enhances edge definition in the final image using an unsharp mask filter. Higher values produce crisper detail. 0 disables sharpening."
          />
        </ParamGrid>
        <ParamSlider
          label="Color temp (K)"
          tooltip="Shifts the color temperature of the image in Kelvin. Lower values (2000K) produce warm, golden tones. Higher values (12000K) produce cool, blue tones. 6500K is neutral daylight."
          keywords={["grading", "temperature", "kelvin", "warmth", "white balance"]}
          value={state.gradingColorTemp}
          onChange={set.gradingColorTemp}
          min={2000}
          max={12000}
          step={100}
        />
      </SectionLeader>

      <SectionDivider />

      <SectionLeader title="Tone" collapsible defaultCollapsed>
        <ParamGrid>
          <ParamSlider
            label="Shadows"
            keywords={["grading", "dark", "lab"]}
            value={state.gradingShadows}
            onChange={set.gradingShadows}
            min={-1}
            max={1}
            step={0.05}
            tooltip="Lightens or darkens the shadow regions of the image. Positive values lift shadows to reveal detail, negative values deepen them. Operates in Lab color space."
          />

          <ParamSlider
            label="Midtones"
            keywords={["grading", "tone", "exposure"]}
            value={state.gradingMidtones}
            onChange={set.gradingMidtones}
            min={-1}
            max={1}
            step={0.05}
            tooltip="Adjusts the brightness of midtone values without affecting deep shadows or bright highlights. Useful for fine-tuning overall image exposure."
          />

          <ParamSlider
            label="CLAHE clip"
            tooltip="Clip limit for Contrast Limited Adaptive Histogram Equalization (CLAHE). Higher values allow more local contrast enhancement. 0 disables CLAHE entirely."
            keywords={["clahe", "adaptive", "histogram", "contrast"]}
            value={state.gradingClaheClip}
            onChange={set.gradingClaheClip}
            min={0}
            max={40}
            step={1}
          />

          <ParamSlider
            label="CLAHE grid"
            tooltip="Grid size for CLAHE tile regions. Smaller grids (2-4) produce more localized contrast enhancement, larger grids (8-16) produce a more global effect."
            keywords={["clahe", "grid", "tiles"]}
            value={state.gradingClaheGrid}
            onChange={set.gradingClaheGrid}
            min={2}
            max={16}
            step={1}
          />
        </ParamGrid>
        <ParamSlider
          label="Highlights"
          keywords={["grading", "bright", "lab"]}
          value={state.gradingHighlights}
          onChange={set.gradingHighlights}
          min={-1}
          max={1}
          step={0.05}
          tooltip="Adjusts the brightness of highlight regions. Positive values brighten highlights, negative values pull them back to recover blown-out detail. Operates in Lab color space."
        />
      </SectionLeader>

      <SectionDivider />

      <SectionLeader title="Split Toning" collapsible defaultCollapsed>
        <ColorPicker
          label="Shadows tint"
          value={state.gradingShadowsTint}
          onChange={set.gradingShadowsTint}
        />

        <ColorPicker
          label="Highlights tint"
          value={state.gradingHighlightsTint}
          onChange={set.gradingHighlightsTint}
        />

        <ParamSlider
          label="Balance"
          keywords={["split", "toning", "crossover"]}
          value={state.gradingSplitToneBalance}
          onChange={set.gradingSplitToneBalance}
          min={0}
          max={1}
          step={0.05}
          tooltip="Controls the crossover point between shadow and highlight tinting. 0 shifts the effect entirely toward shadows, 1 shifts it entirely toward highlights. 0.5 is an even split."
        />
      </SectionLeader>

      <SectionDivider />

      <SectionLeader title="Effects" collapsible defaultCollapsed>
        <ParamGrid>
          <ParamSlider
            label="Vignette"
            keywords={["grading", "edges", "border"]}
            value={state.gradingVignette}
            onChange={set.gradingVignette}
            min={0}
            max={1}
            step={0.05}
            tooltip="Adds radial edge darkening that draws the eye toward the center of the image. Higher values produce a more pronounced dark border. 0 disables the effect."
          />

          <ParamSlider
            label="Grain"
            keywords={["grading", "noise", "film"]}
            value={state.gradingGrain}
            onChange={set.gradingGrain}
            min={0}
            max={1}
            step={0.05}
            tooltip="Adds random film grain noise to the final image. Higher values produce more visible texture. 0 disables the effect."
          />
        </ParamGrid>
      </SectionLeader>

      <SectionDivider />

      <SectionLeader title="LUT" collapsible defaultCollapsed>
        <div className="flex items-center gap-2">
          <ParamLabel
            className="text-2xs text-muted-foreground w-16 flex-shrink-0"
            tooltip={getParamHelp("lut file")}
          >
            File
          </ParamLabel>
          {hasLut ? (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <span className="text-2xs truncate flex-1">{lutFileName}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={clearLut}
                title="Remove LUT"
              >
                <X size={12} />
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-2xs gap-1.5 flex-1"
              onClick={() => lutInputRef.current?.click()}
            >
              <Upload size={12} />
              Upload .cube file
            </Button>
          )}
          <input
            ref={lutInputRef}
            type="file"
            accept=".cube"
            className="hidden"
            onChange={handleLutFile}
          />
        </div>
        <ParamSlider
          label="Strength"
          keywords={["lut", "lookup", "color grading"]}
          value={state.gradingLutStrength}
          onChange={set.gradingLutStrength}
          min={0}
          max={2}
          step={0.05}
          disabled={!hasLut}
          tooltip="Controls the intensity of the LUT color grading. 1.0 applies the LUT at full strength. Values below 1.0 blend with the original colors, values above 1.0 amplify the effect."
        />
      </SectionLeader>
    </div>
  );
}
