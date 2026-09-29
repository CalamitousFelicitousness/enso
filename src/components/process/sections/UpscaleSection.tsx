import { useEffect } from "react";
import { ArrowLeftRight } from "lucide-react";
import { useUpscalerGroups } from "@/api/hooks/useModels";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { ParamRow, ParamGrid } from "@/components/generation/ParamRow";
import { Combobox } from "@/components/ui/combobox";
import { NumberInput } from "@/components/ui/number-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Button } from "@/components/ui/button";
import { ProcessSection, CheckRow } from "./ProcessSection";
import { useProcessSection } from "./useProcessSection";

const MODES = [
  { value: "0", label: "Scale by" },
  { value: "1", label: "Scale to" },
];

export function UpscaleSection() {
  const { enabled, params, applies, setEnabled, set } = useProcessSection("upscale");
  const groups = useUpscalerGroups();
  const scaleTo = params.upscale_mode === 1;
  const setUpscaler = set("upscaler_1_name");

  // "None" makes the script a no-op; start on the first real upscaler
  useEffect(() => {
    if (params.upscaler_1_name !== "None") return;
    const first = groups
      .flatMap((g) => g.options)
      .find((o) => (typeof o === "string" ? o : o.value) !== "None");
    if (first) setUpscaler(typeof first === "string" ? first : first.value);
  }, [groups, params.upscaler_1_name, setUpscaler]);

  return (
    <ProcessSection
      title="Upscale"
      tooltip="Resize with a pixel or model upscaler. A second upscaler can be blended in for a different texture."
      enabled={enabled}
      onToggleEnabled={setEnabled}
      applies={applies}
      defaultCollapsed={false}
      inapplicableHint="Upscale takes images. Use SeedVR or DLSS to upscale a video."
    >
      <ParamRow
        label="Upscaler"
        tooltip="Which upscaler resizes the image. Resize entries are plain filters; the rest are models that add detail."
      >
        <Combobox
          value={params.upscaler_1_name}
          onValueChange={setUpscaler}
          groups={groups}
          placeholder="Select upscaler..."
          className="h-6 text-2xs w-full"
        />
      </ParamRow>
      <SegmentedControl
        options={MODES}
        value={String(params.upscale_mode)}
        onValueChange={(v) => set("upscale_mode")(Number(v))}
        animated
      />
      {scaleTo ? (
        <>
          <div className="flex items-end gap-1">
            <ParamRow label="Width">
              <NumberInput
                value={params.upscale_to_width}
                onChange={set("upscale_to_width")}
                min={64}
                max={16384}
                step={8}
              />
            </ParamRow>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title="Swap width and height"
              onClick={() => {
                set("upscale_to_width")(params.upscale_to_height);
                set("upscale_to_height")(params.upscale_to_width);
              }}
            >
              <ArrowLeftRight size={12} />
            </Button>
            <ParamRow label="Height">
              <NumberInput
                value={params.upscale_to_height}
                onChange={set("upscale_to_height")}
                min={64}
                max={16384}
                step={8}
              />
            </ParamRow>
          </div>
          <CheckRow
            label="Crop to fit"
            checked={params.upscale_crop}
            onCheckedChange={set("upscale_crop")}
            title="Scale to cover the target size, then crop the overflow so the result is exactly that size"
          />
        </>
      ) : (
        <ParamSlider
          label="Scale"
          tooltip="Multiplier on the input size. Model upscalers run at their native factor and are resized to this."
          value={params.upscale_by}
          onChange={set("upscale_by")}
          min={0.1}
          max={8}
          step={0.05}
          decimals={2}
        />
      )}
      <ParamRow
        label="Refine upscaler"
        tooltip="A second upscaler whose result is blended over the first. None disables the blend."
      >
        <Combobox
          value={params.upscaler_2_name}
          onValueChange={set("upscaler_2_name")}
          groups={groups}
          placeholder="None"
          className="h-6 text-2xs w-full"
        />
      </ParamRow>
      <ParamGrid>
        <ParamSlider
          label="Blend"
          tooltip="How much of the refine upscaler shows through: 0 is only the first upscaler, 1 is only the second."
          value={params.upscaler_2_visibility}
          onChange={set("upscaler_2_visibility")}
          min={0}
          max={1}
          step={0.01}
          decimals={2}
          disabled={params.upscaler_2_name === "None"}
          disabledHint="Pick a refine upscaler first"
        />
      </ParamGrid>
    </ProcessSection>
  );
}
