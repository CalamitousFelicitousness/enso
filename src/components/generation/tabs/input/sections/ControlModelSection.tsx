// Which control model runs on a Control frame's picture, and how strongly.

import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useControlModels, useControlModes } from "@/api/hooks/useControl";
import { SectionLeader } from "@/components/ui/section-leader";
import { Combobox } from "@/components/ui/combobox";
import { Checkbox } from "@/components/ui/checkbox";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { ParamGrid } from "@/components/generation/ParamRow";
import { Button } from "@/components/ui/button";
import { useInputStore } from "@/stores/inputStore";
import { sentAsImage } from "@/lib/inputs/outline";
import { controlTypeLabel, notSentLabel, sendAsImageLabel } from "@/lib/inputs/text";
import { CONTROL_TYPES, type ControlType, type Frame } from "@/lib/inputs/types";
import { Row } from "../Row";

/** The modes sdnext lists for a model: by its name, else by a listed key the name contains. */
function modesFor(modes: Record<string, string[]> | undefined, model: string): string[] | null {
  if (!modes || model === "None") return null;
  if (modes[model]) return modes[model];
  for (const [key, list] of Object.entries(modes)) {
    if (model.toLowerCase().includes(key.toLowerCase())) return list;
  }
  return null;
}

export function ControlModelSection({ frame }: { frame: Frame }) {
  const patchControl = useInputStore((s) => s.patchControl);
  const switchRole = useInputStore((s) => s.switchRole);
  const control = frame.control;
  const { data: models } = useControlModels(control.type);
  const { data: controlModes } = useControlModes();
  const set = (patch: Partial<typeof control>) => patchControl(frame.id, patch);
  // Without a model the frame sends nothing; it can be an image instead
  const asImage = useInputStore(
    useShallow((s) =>
      control.model === "None" && control.type !== "style_transfer"
        ? sentAsImage(s.frames, frame.id)
        : null,
    ),
  );

  const modes = useMemo(() => modesFor(controlModes, control.model), [controlModes, control.model]);

  // A model with listed modes runs in its first one unless another is picked:
  // sdnext maps an unknown mode to the first one on its own, without a word.
  useEffect(() => {
    if (modes && modes.length > 0 && !modes.includes(control.mode)) set({ mode: modes[0] });
  });

  const showModel = control.type !== "style_transfer";

  return (
    <SectionLeader title="Control model" collapsible>
      <Row label="Type">
        <Combobox
          value={control.type}
          onValueChange={(v) => set({ type: v as ControlType })}
          options={CONTROL_TYPES.map((t) => ({ value: t, label: controlTypeLabel(t) }))}
          className="h-6 text-2xs flex-1"
        />
      </Row>
      {showModel && (
        <Row label="Model">
          <Combobox
            value={control.model}
            onValueChange={(v) => set({ model: v, mode: "default" })}
            options={["None", ...(models ?? [])]}
            className="h-6 text-2xs flex-1"
          />
        </Row>
      )}
      {asImage && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-3xs text-amber-400">{notSentLabel("noModel")}</span>
          <Button
            variant="outline"
            size="sm"
            className="h-5 shrink-0 rounded px-1.5 text-3xs"
            onClick={() => switchRole(frame.id, "reference")}
          >
            {sendAsImageLabel(asImage)}
          </Button>
        </div>
      )}
      {showModel && modes && modes.length > 0 && (
        <Row label="Mode">
          <Combobox
            value={control.mode}
            onValueChange={(v) => set({ mode: v })}
            options={modes}
            className="h-6 text-2xs flex-1"
          />
        </Row>
      )}
      {showModel && (
        <ParamSlider
          label="Strength"
          tooltip="How strongly the control model steers the generation. 1 follows the picture closely; lower values leave the prompt more room."
          keywords={["weight", "control weight", "conditioning scale"]}
          value={control.strength}
          onChange={(v) => set({ strength: v })}
          min={0.01}
          max={2}
          step={0.01}
        />
      )}
      {control.type === "controlnet" && (
        <label className="flex items-center gap-1.5 text-2xs text-muted-foreground cursor-pointer">
          <Checkbox checked={control.guess} onCheckedChange={(c) => set({ guess: !!c })} />
          Guess mode
        </label>
      )}
      {control.type === "t2i" && (
        <ParamSlider
          label="Factor"
          tooltip="How much of the adapter's output reaches the model."
          value={control.factor}
          onChange={(v) => set({ factor: v })}
          min={0.01}
          max={2}
          step={0.01}
        />
      )}
      {control.type === "style_transfer" && (
        <>
          <Row label="Attention">
            <Combobox
              value={control.attention}
              onValueChange={(v) => set({ attention: v })}
              options={["Attention", "Adain", "Attention and Adain"]}
              className="h-6 text-2xs flex-1"
            />
          </Row>
          <ParamGrid>
            <ParamSlider
              label="Query weight"
              tooltip="Weight of the attention path of the style transfer."
              value={control.queryWeight}
              onChange={(v) => set({ queryWeight: v })}
              min={0}
              max={2}
              step={0.01}
            />
            <ParamSlider
              label="Adain weight"
              tooltip="Weight of the AdaIN path of the style transfer."
              value={control.adainWeight}
              onChange={(v) => set({ adainWeight: v })}
              min={0}
              max={2}
              step={0.01}
            />
          </ParamGrid>
          <ParamSlider
            label="Fidelity"
            tooltip="How closely the result keeps to the style picture."
            value={control.fidelity}
            onChange={(v) => set({ fidelity: v })}
            min={0}
            max={1}
            step={0.01}
          />
        </>
      )}
    </SectionLeader>
  );
}
