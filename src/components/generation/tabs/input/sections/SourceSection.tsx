// Where a Control frame's picture comes from: its own layers, laid out by its
// fit, or another composed frame's picture.

import { useMemo } from "react";
import { SectionLeader } from "@/components/ui/section-leader";
import { Combobox } from "@/components/ui/combobox";
import { useInputStore } from "@/stores/inputStore";
import { useOutline } from "@/inputs/useOutline";
import { positionLabel } from "@/lib/inputs/text";
import type { FitPolicy, Frame } from "@/lib/inputs/types";
import { Row } from "../Row";

/** The fit a Control frame lays its picture out with; "by hand" leaves it where it is. */
const FITS: { value: string; label: string }[] = [
  { value: "contain", label: "Fit inside" },
  { value: "cover", label: "Fill, crop" },
  { value: "fill", label: "Stretch" },
  { value: "free", label: "By hand" },
];

export function SourceSection({ frame }: { frame: Frame }) {
  const setFit = useInputStore((s) => s.setFit);
  const setLink = useInputStore((s) => s.setLink);
  const outline = useOutline();

  // Composed frames other than this one
  const linkOptions = useMemo(
    () =>
      outline.entries
        .filter((e) => e.frameId !== frame.id && (e.role === "initial" || e.role === "control"))
        .map((e) => ({ value: e.frameId, label: `uses ${positionLabel(e.position)}` })),
    [outline, frame.id],
  );

  return (
    <SectionLeader title="Source" collapsible>
      <Row label="Picture">
        <Combobox
          value={frame.link?.frameId ?? "own"}
          onValueChange={(v) => setLink(frame.id, v === "own" ? null : v)}
          options={[{ value: "own", label: "Own picture" }, ...linkOptions]}
          className="h-6 text-2xs flex-1"
        />
      </Row>
      {!frame.link && (
        <Row label="Fit">
          <Combobox
            value={frame.fit ?? "free"}
            onValueChange={(v) => setFit(frame.id, v === "free" ? null : (v as FitPolicy))}
            options={FITS}
            className="h-6 text-2xs flex-1"
          />
        </Row>
      )}
    </SectionLeader>
  );
}
