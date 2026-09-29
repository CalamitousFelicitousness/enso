import { useEffect } from "react";
import { usePostprocessChoices } from "@/api/hooks/usePostprocess";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { ParamRow, ParamGrid } from "@/components/generation/ParamRow";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SectionLeader } from "@/components/ui/section-leader";
import { ProcessSection, CheckRow } from "./ProcessSection";
import { useProcessSection } from "./useProcessSection";

const METHODS = ["none", "pixelate", "blur", "image", "block"];

export function NudenetSection() {
  const { enabled, params, applies, setEnabled, set } = useProcessSection("nudenet");
  const labels = usePostprocessChoices("NudeNet", "censor");
  const policyModels = usePostprocessChoices("NudeNet", "policy_model");
  const setPolicyModel = set("policy_model");

  // the server has no empty policy model; take its first once known
  useEffect(() => {
    if (!params.policy_model && policyModels[0]) setPolicyModel(policyModels[0]);
  }, [params.policy_model, policyModels, setPolicyModel]);

  const toggleLabel = (name: string, on: boolean) =>
    set("censor")(on ? [...params.censor, name] : params.censor.filter((l) => l !== name));

  return (
    <ProcessSection
      title="NudeNet"
      tooltip="Detects nudity and censors the matching regions; can also rate the image against a policy."
      enabled={enabled}
      onToggleEnabled={setEnabled}
      applies={applies}
      inapplicableHint="NudeNet takes images."
    >
      <ParamRow
        label="Censor"
        tooltip="Which detected body parts get covered. Nothing selected only records what was found."
      >
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
          {labels.map((name) => (
            <CheckRow
              key={name}
              label={name.replace(/_/g, " ").toLowerCase()}
              checked={params.censor.includes(name)}
              onCheckedChange={(on) => toggleLabel(name, on)}
            />
          ))}
          {labels.length === 0 && (
            <span className="text-2xs text-muted-foreground col-span-2">
              Labels load from the server.
            </span>
          )}
        </div>
      </ParamRow>
      <ParamGrid>
        <ParamRow
          label="Method"
          tooltip="How a censored region is covered: pixelate, blur, a solid block, or an overlay image."
        >
          <Combobox
            value={params.method}
            onValueChange={set("method")}
            options={METHODS}
            className="h-6 text-2xs w-full"
          />
        </ParamRow>
        <ParamRow
          label="Overlay"
          tooltip="Server path of the image used by the image method; empty uses the built-in one."
        >
          <Input
            value={params.overlay}
            onChange={(e) => set("overlay")(e.target.value)}
            placeholder="default"
            className="h-6 text-2xs px-2"
            disabled={params.method !== "image"}
          />
        </ParamRow>
      </ParamGrid>
      <ParamGrid>
        <ParamSlider
          label="Sensitivity"
          tooltip="Minimum detection score to act on. Lower catches more, with more false positives."
          value={params.score}
          onChange={set("score")}
          min={0}
          max={1}
          step={0.01}
          decimals={2}
        />
        <ParamSlider
          label="Block size"
          tooltip="Coarseness of the pixelate and block methods."
          value={params.blocks}
          onChange={set("blocks")}
          min={1}
          max={10}
          step={1}
        />
      </ParamGrid>
      <div className="grid grid-cols-2 gap-1">
        <CheckRow
          label="Update metadata"
          checked={params.metadata}
          onCheckedChange={set("metadata")}
          title="Write the detections and the NSFW verdict into the saved file's metadata"
        />
      </div>
      <SectionLeader title="Policy" level={1} collapsible defaultCollapsed>
        <CheckRow
          label="Check policy violations"
          checked={params.policy}
          onCheckedChange={set("policy")}
          title="Rate the image with a vision-language safety model"
        />
        <ParamRow label="Policy model">
          <Combobox
            value={params.policy_model}
            onValueChange={setPolicyModel}
            options={policyModels}
            className="h-6 text-2xs w-full"
            disabled={!params.policy}
          />
        </ParamRow>
        <ParamRow
          label="Policy template"
          tooltip="Custom policy text for the safety model; empty uses its default."
        >
          <Textarea
            value={params.policy_text}
            onChange={(e) => set("policy_text")(e.target.value)}
            rows={2}
            className="text-2xs"
            disabled={!params.policy}
          />
        </ParamRow>
      </SectionLeader>
    </ProcessSection>
  );
}
