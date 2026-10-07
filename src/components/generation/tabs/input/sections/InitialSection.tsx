// Denoise and the mask settings, which apply to the first Initial picture
// sent: shown on that frame, named from any other.

import { SectionLeader } from "@/components/ui/section-leader";
import { StrengthSlider } from "@/components/generation/StrengthSlider";
import { MaskParams } from "@/components/generation/MaskParams";
import type { Outline } from "@/lib/inputs/outline";
import { positionLabel } from "@/lib/inputs/text";
import type { Frame } from "@/lib/inputs/types";

export function InitialSection({ frame, outline }: { frame: Frame; outline: Outline }) {
  const primary = outline.sent[0];
  const applies = primary?.frameId === frame.id;
  const elsewhere =
    primary?.role === "initial"
      ? outline.entries.find((e) => e.frameId === primary.frameId)?.position
      : undefined;
  return (
    <SectionLeader title="Initial" collapsible>
      {applies ? (
        <>
          <StrengthSlider />
          <MaskParams />
        </>
      ) : (
        <p className="text-3xs text-muted-foreground">
          {elsewhere
            ? `Denoise and the mask apply to ${positionLabel(elsewhere)}, the first Initial picture sent.`
            : "Denoise and the mask apply to the first Initial picture sent."}
        </p>
      )}
    </SectionLeader>
  );
}
