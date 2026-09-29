import { ParamSlider } from "@/components/generation/ParamSlider";
import { ParamGrid } from "@/components/generation/ParamRow";
import { ProcessSection, CheckRow } from "./ProcessSection";
import { useProcessSection } from "./useProcessSection";

export function PixelartSection() {
  const { enabled, params, applies, setEnabled, set } = useProcessSection("pixelart");

  return (
    <ProcessSection
      title="PixelArt"
      tooltip="Quantizes the image into blocks of flat color, like low-resolution pixel art."
      enabled={enabled}
      onToggleEnabled={setEnabled}
      applies={applies}
      inapplicableHint="PixelArt takes images."
    >
      <ParamGrid>
        <ParamSlider
          label="Block size"
          tooltip="Size of each output pixel in source pixels. Larger blocks mean a coarser result."
          value={params.pixelart_block_size}
          onChange={set("pixelart_block_size")}
          min={2}
          max={64}
          step={1}
        />
        <ParamSlider
          label="Sharpen"
          tooltip="Sharpening applied before quantizing, to keep edges crisp between blocks."
          value={params.pixelart_sharpen_amount}
          onChange={set("pixelart_sharpen_amount")}
          min={0}
          max={1}
          step={0.01}
          decimals={2}
        />
      </ParamGrid>
      <CheckRow
        label="Edge detection"
        checked={params.pixelart_use_edge_detection}
        onCheckedChange={set("pixelart_use_edge_detection")}
        title="Trace outlines first so the blocks follow the shapes in the image"
      />
      <ParamGrid>
        <ParamSlider
          label="Edge block size"
          tooltip="Block size used for the outline pass; smaller keeps finer outlines."
          value={params.pixelart_edge_block_size}
          onChange={set("pixelart_edge_block_size")}
          min={2}
          max={64}
          step={1}
          disabled={!params.pixelart_use_edge_detection}
          disabledHint="Turn on edge detection first"
        />
        <ParamSlider
          label="Edge image weight"
          tooltip="How strongly the traced outlines are mixed back into the image before quantizing."
          value={params.pixelart_image_weight}
          onChange={set("pixelart_image_weight")}
          min={0}
          max={2}
          step={0.01}
          decimals={2}
          disabled={!params.pixelart_use_edge_detection}
          disabledHint="Turn on edge detection first"
        />
      </ParamGrid>
    </ProcessSection>
  );
}
