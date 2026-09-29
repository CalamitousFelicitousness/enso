import { usePostprocessChoices } from "@/api/hooks/usePostprocess";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { ParamRow, ParamGrid } from "@/components/generation/ParamRow";
import { Combobox } from "@/components/ui/combobox";
import { ProcessSection, CheckRow } from "./ProcessSection";
import { useProcessSection } from "./useProcessSection";

const FALLBACK_MODELS = [
  "lucida",
  "ben2",
  "silueta",
  "u2net",
  "u2net_human_seg",
  "isnet-general-use",
  "isnet-anime",
];

const MODEL_LABELS: Record<string, string> = {
  lucida: "Lucida",
  ben2: "BEN2",
  silueta: "Silueta",
  u2net: "U2Net",
  u2net_human_seg: "U2Net Human",
  "isnet-general-use": "ISNet General",
  "isnet-anime": "ISNet Anime",
};

export function RembgSection() {
  const { enabled, params, applies, setEnabled, set } = useProcessSection("rembg");
  const serverModels = usePostprocessChoices("Remove background", "model");
  const models = (serverModels.length ? serverModels : FALLBACK_MODELS)
    .filter((m) => m !== "none")
    .map((m) => ({ value: m, label: MODEL_LABELS[m] ?? m }));
  const isBen2 = params.model === "ben2";
  const isRembg = !isBen2 && params.model !== "lucida";

  return (
    <ProcessSection
      title="Remove Background"
      tooltip="Cuts the subject out and makes the background transparent."
      enabled={enabled}
      onToggleEnabled={setEnabled}
      applies={applies}
      inapplicableHint="Background removal takes images."
    >
      <ParamRow
        label="Model"
        tooltip="BEN2 and Lucida are the newer matting models. U2Net and ISNet are the classic segmenters; ISNet Anime is tuned for drawn characters."
      >
        <Combobox
          value={params.model}
          onValueChange={set("model")}
          options={models}
          placeholder="Select model..."
          className="h-6 text-2xs w-full"
        />
      </ParamRow>
      <div className="grid grid-cols-2 gap-1">
        <CheckRow
          label="Mask only"
          checked={params.mask_only}
          onCheckedChange={set("mask_only")}
          title="Return the black and white cutout mask instead of the cut-out image"
        />
        <CheckRow
          label="Merge alpha"
          checked={params.merge_alpha}
          onCheckedChange={set("merge_alpha")}
          title="Flatten the transparent result onto black so the file has no alpha channel"
        />
        {isBen2 && (
          <CheckRow
            label="Refine foreground"
            checked={params.refine}
            onCheckedChange={set("refine")}
            title="A second pass that cleans the edge of the cutout; slower"
          />
        )}
        {isRembg && (
          <>
            <CheckRow
              label="Postprocess mask"
              checked={params.postprocess_mask}
              onCheckedChange={set("postprocess_mask")}
              title="Smooth the mask edge before cutting"
            />
            <CheckRow
              label="Alpha matting"
              checked={params.alpha_matting}
              onCheckedChange={set("alpha_matting")}
              title="Estimate soft edges such as hair instead of a hard cut; slower"
            />
          </>
        )}
      </div>
      {isRembg && params.alpha_matting && (
        <>
          <ParamGrid>
            <ParamSlider
              label="Foreground threshold"
              tooltip="Pixels the model rates above this are treated as fully opaque subject."
              value={params.alpha_matting_foreground_threshold}
              onChange={set("alpha_matting_foreground_threshold")}
              min={0}
              max={255}
              step={1}
            />
            <ParamSlider
              label="Background threshold"
              tooltip="Pixels the model rates below this are treated as fully transparent background."
              value={params.alpha_matting_background_threshold}
              onChange={set("alpha_matting_background_threshold")}
              min={0}
              max={255}
              step={1}
            />
          </ParamGrid>
          <ParamSlider
            label="Erode size"
            tooltip="How far the uncertain band between subject and background is widened before matting."
            value={params.alpha_matting_erode_size}
            onChange={set("alpha_matting_erode_size")}
            min={0}
            max={40}
            step={1}
          />
        </>
      )}
    </ProcessSection>
  );
}
