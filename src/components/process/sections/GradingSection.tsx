import { useCallback, useRef } from "react";
import { Upload, X } from "lucide-react";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { ParamGrid } from "@/components/generation/ParamRow";
import { ParamLabel } from "@/components/generation/ParamLabel";
import { ColorPicker } from "@/components/ui/color-picker";
import { Button } from "@/components/ui/button";
import { SectionLeader } from "@/components/ui/section-leader";
import { uploadFile } from "@/lib/upload";
import { ProcessSection } from "./ProcessSection";
import { useProcessSection } from "./useProcessSection";

export function GradingSection() {
  const { enabled, params, applies, setEnabled, set } = useProcessSection("grading");
  const lutInputRef = useRef<HTMLInputElement>(null);
  const hasLut = !!params.lut_cube_file;
  const lutName = hasLut ? (params.lut_cube_file.split("/").pop() ?? "") : "";

  const handleLutFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      set("lut_cube_file")(await uploadFile(file));
    },
    [set],
  );

  return (
    <ProcessSection
      title="Color Grading"
      tooltip="Pixel-level color adjustments on the processed image, applied in the order shown."
      enabled={enabled}
      onToggleEnabled={setEnabled}
      applies={applies}
      inapplicableHint="Color grading takes images."
    >
      <SectionLeader title="Basic" level={1} collapsible>
        <ParamGrid>
          <ParamSlider
            label="Brightness"
            tooltip="Positive values lighten, negative darken."
            value={params.brightness}
            onChange={set("brightness")}
            min={-1}
            max={1}
            step={0.05}
          />
          <ParamSlider
            label="Contrast"
            tooltip="Positive values widen the tonal range, negative flatten it."
            value={params.contrast}
            onChange={set("contrast")}
            min={-1}
            max={1}
            step={0.05}
          />
          <ParamSlider
            label="Saturation"
            tooltip="Positive values make colors more vivid, negative pull toward grayscale."
            value={params.saturation}
            onChange={set("saturation")}
            min={-1}
            max={1}
            step={0.05}
          />
          <ParamSlider
            label="Hue"
            tooltip="Rotates every color around the wheel. 0 and 1 leave colors unchanged, 0.5 swaps them for their complements."
            value={params.hue}
            onChange={set("hue")}
            min={0}
            max={1}
            step={0.05}
          />
          <ParamSlider
            label="Gamma"
            tooltip="Below 1 brightens midtones and shadows, above 1 darkens them. 1 is unchanged."
            value={params.gamma}
            onChange={set("gamma")}
            min={0.1}
            max={10}
            step={0.1}
          />
          <ParamSlider
            label="Sharpness"
            tooltip="Edge sharpening. 0 is off."
            value={params.sharpness}
            onChange={set("sharpness")}
            min={0}
            max={2}
            step={0.05}
          />
        </ParamGrid>
        <ParamSlider
          label="Color temp (K)"
          tooltip="White balance in Kelvin. Low is warm and golden, high is cool and blue, 6500 is neutral daylight."
          value={params.color_temp}
          onChange={set("color_temp")}
          min={2000}
          max={12000}
          step={100}
        />
      </SectionLeader>
      <SectionLeader title="Tone" level={1} collapsible defaultCollapsed>
        <ParamGrid>
          <ParamSlider
            label="Shadows"
            tooltip="Lifts or deepens the dark regions."
            value={params.shadows}
            onChange={set("shadows")}
            min={-1}
            max={1}
            step={0.05}
          />
          <ParamSlider
            label="Midtones"
            tooltip="Brightens or darkens the middle range without touching deep shadows or bright highlights."
            value={params.midtones}
            onChange={set("midtones")}
            min={-1}
            max={1}
            step={0.05}
          />
          <ParamSlider
            label="Highlights"
            tooltip="Brightens the bright regions or pulls them back to recover detail."
            value={params.highlights}
            onChange={set("highlights")}
            min={-1}
            max={1}
            step={0.05}
          />
          <ParamSlider
            label="CLAHE clip"
            tooltip="Local contrast enhancement. Higher brings out detail in flat regions, very high amplifies noise. 0 is off."
            value={params.clahe_clip}
            onChange={set("clahe_clip")}
            min={0}
            max={5}
            step={0.25}
            decimals={2}
          />
        </ParamGrid>
        <ParamSlider
          label="CLAHE grid"
          tooltip="Tile count for the local contrast pass. Small grids equalize coarsely, large grids enhance finer detail."
          value={params.clahe_grid}
          onChange={set("clahe_grid")}
          min={2}
          max={16}
          step={1}
          disabled={params.clahe_clip === 0}
          disabledHint="Raise CLAHE clip above 0 first"
        />
      </SectionLeader>
      <SectionLeader title="Split Toning" level={1} collapsible defaultCollapsed>
        <ColorPicker
          label="Shadows tint"
          value={params.shadows_tint}
          onChange={set("shadows_tint")}
        />
        <ColorPicker
          label="Highlights tint"
          value={params.highlights_tint}
          onChange={set("highlights_tint")}
        />
        <ParamSlider
          label="Balance"
          tooltip="Where the shadow tint hands over to the highlight tint. Below 0.5 the shadow tint reaches into the midtones, above 0.5 the highlight tint does."
          value={params.split_tone_balance}
          onChange={set("split_tone_balance")}
          min={0}
          max={1}
          step={0.05}
        />
      </SectionLeader>
      <SectionLeader title="Effects" level={1} collapsible defaultCollapsed>
        <ParamGrid>
          <ParamSlider
            label="Vignette"
            tooltip="Darkens the edges toward the corners. 0 is off."
            value={params.vignette}
            onChange={set("vignette")}
            min={0}
            max={1}
            step={0.05}
          />
          <ParamSlider
            label="Grain"
            tooltip="Adds film grain. 0 is off."
            value={params.grain}
            onChange={set("grain")}
            min={0}
            max={1}
            step={0.05}
          />
        </ParamGrid>
      </SectionLeader>
      <SectionLeader title="LUT" level={1} collapsible defaultCollapsed>
        <div className="flex items-center gap-2">
          <ParamLabel
            className="text-2xs text-muted-foreground w-16 flex-shrink-0"
            tooltip="A .cube lookup table applied as the last grading step."
          >
            File
          </ParamLabel>
          {hasLut ? (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <span className="text-2xs truncate flex-1">{lutName}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => set("lut_cube_file")("")}
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
            onChange={(e) => void handleLutFile(e)}
          />
        </div>
        <ParamSlider
          label="Strength"
          tooltip="1 applies the LUT fully, below 1 blends toward the original, above 1 exaggerates it."
          value={params.lut_strength}
          onChange={set("lut_strength")}
          min={0}
          max={2}
          step={0.05}
          disabled={!hasLut}
          disabledHint="Upload a .cube file first"
        />
      </SectionLeader>
    </ProcessSection>
  );
}
