// Over which part of the sampling a control model or IP-Adapter applies.

import { SectionLeader } from "@/components/ui/section-leader";
import { ParamSlider } from "@/components/generation/ParamSlider";
import { ParamGrid } from "@/components/generation/ParamRow";
import { useInputStore } from "@/stores/inputStore";
import type { Frame } from "@/lib/inputs/types";

export function TimingSection({ frame }: { frame: Frame }) {
  const patchControl = useInputStore((s) => s.patchControl);
  const patchIpAdapter = useInputStore((s) => s.patchIpAdapter);
  const adapter = frame.role === "ipAdapter";
  const timing = adapter ? frame.ipAdapter : frame.control;
  const set = (patch: { start?: number; end?: number }) =>
    adapter ? patchIpAdapter(frame.id, patch) : patchControl(frame.id, patch);

  return (
    <SectionLeader title="Timing" collapsible defaultCollapsed>
      <ParamGrid>
        <ParamSlider
          label="Start"
          tooltip="The point in the sampling, as a fraction of the steps, from which the control applies."
          value={timing.start}
          onChange={(v) => set({ start: v })}
          min={0}
          max={1}
          step={0.01}
        />
        <ParamSlider
          label="End"
          tooltip="The point in the sampling, as a fraction of the steps, after which the control stops."
          value={timing.end}
          onChange={(v) => set({ end: v })}
          min={0}
          max={1}
          step={0.01}
        />
      </ParamGrid>
    </SectionLeader>
  );
}
