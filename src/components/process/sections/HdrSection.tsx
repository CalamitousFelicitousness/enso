import { Combobox } from "@/components/ui/combobox";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { ParamGrid, ParamRow } from "@/components/generation/ParamRow";
import { usePostprocessChoices, usePostprocessScripts } from "@/api/hooks/usePostprocess";
import { useOptions } from "@/api/hooks/useSettings";
import { useProcessStore } from "@/stores/processStore";
import { hdrState } from "@/lib/processHdr";
import { ProcessSection } from "./ProcessSection";
import { useProcessSection } from "./useProcessSection";

const GAMUTS = ["Rec.2020", "DCI-P3"];

export function HdrSection() {
  const { enabled, params, mode, setEnabled, set } = useProcessSection("hdr");
  const saveOutput = useProcessStore((s) => s.saveOutput);
  const { data: scripts } = usePostprocessScripts();
  const { data: options } = useOptions();
  const served = usePostprocessChoices("HDR", "hdr_gamut");
  const format = (options as Record<string, unknown> | undefined)?.["samples_format"];
  const state = hdrState(
    scripts?.hdr,
    typeof format === "string" ? format : undefined,
    mode,
    saveOutput,
  );

  return (
    <ProcessSection
      title="HDR"
      tooltip="Writes a high dynamic range copy of each saved image beside it. Its file type follows the image file format in Settings."
      enabled={enabled}
      onToggleEnabled={setEnabled}
      applies={state.applies}
      inapplicableHint={state.applies ? undefined : state.hint}
    >
      <ParamGrid>
        <ParamSlider
          label="Peak brightness"
          tooltip="Brightest highlight the HDR file asks the display for, in nits. Around 1000 suits most HDR monitors; higher values brighten highlights on displays that can show them."
          value={params.hdr_peak}
          onChange={set("hdr_peak")}
          min={100}
          max={10000}
          step={100}
          suffix=" nits"
        />
      </ParamGrid>
      <ParamRow
        label="Color gamut"
        tooltip="Color range of the HDR file. Rec.2020 is the HDR standard; DCI-P3 is the range most HDR monitors and phones show."
      >
        <Combobox
          value={params.hdr_gamut}
          onValueChange={set("hdr_gamut")}
          options={served.length > 0 ? served : GAMUTS}
          className="h-6 text-2xs w-full"
        />
      </ParamRow>
      <p className="min-h-4 text-3xs text-muted-foreground">{state.applies ? state.note : ""}</p>
    </ProcessSection>
  );
}
