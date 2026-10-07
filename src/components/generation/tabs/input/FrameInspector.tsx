// The settings of one frame, by role. The Input tab shows it under the
// outline; each canvas dock shows the same under its Options tab.

import { SectionLeader } from "@/components/ui/section-leader";
import { useInputStore } from "@/stores/inputStore";
import { useOutline } from "@/inputs/useOutline";
import { outlineEntry } from "@/lib/inputs/outline";
import { RoleToggle } from "./RoleToggle";
import { ROLE_SUMMARY } from "./roleHints";
import { ControlModelSection } from "./sections/ControlModelSection";
import { InitialSection } from "./sections/InitialSection";
import { IpAdapterSection } from "./sections/IpAdapterSection";
import { PicturesSection } from "./sections/PicturesSection";
import { ProcessorSection } from "./sections/ProcessorSection";
import { SourceSection } from "./sections/SourceSection";
import { TimingSection } from "./sections/TimingSection";

interface FrameInspectorProps {
  frameId: string;
  /** The dock carries its own role toggle. */
  withRole?: boolean | undefined;
}

export function FrameInspector({ frameId, withRole = true }: FrameInspectorProps) {
  const frame = useInputStore((s) => s.frames.find((f) => f.id === frameId));
  const switchRole = useInputStore((s) => s.switchRole);
  const outline = useOutline();
  const entry = outlineEntry(outline, frameId);
  if (!frame || !entry) return null;

  const role = (
    <SectionLeader title="Role">
      <RoleToggle role={frame.role} onChange={(next) => switchRole(frame.id, next)} />
      <p className="text-3xs text-muted-foreground">{ROLE_SUMMARY[frame.role]}</p>
    </SectionLeader>
  );
  const pictures = <PicturesSection frame={frame} entry={entry} />;

  switch (frame.role) {
    case "initial":
      return (
        <div className="flex flex-col gap-3">
          {withRole && role}
          {pictures}
          <InitialSection frame={frame} outline={outline} />
        </div>
      );
    case "reference":
      return (
        <div className="flex flex-col gap-3">
          {withRole && role}
          {pictures}
        </div>
      );
    case "control":
      return (
        <div className="flex flex-col gap-3">
          {withRole && role}
          <SourceSection frame={frame} />
          {!frame.link && pictures}
          <ControlModelSection frame={frame} />
          {frame.control.type !== "style_transfer" && <ProcessorSection frame={frame} />}
          {(frame.control.type === "controlnet" || frame.control.type === "xs") && (
            <TimingSection frame={frame} />
          )}
        </div>
      );
    case "ipAdapter":
      return (
        <div className="flex flex-col gap-3">
          {withRole && role}
          {pictures}
          <IpAdapterSection frame={frame} />
          <TimingSection frame={frame} />
        </div>
      );
  }
}
