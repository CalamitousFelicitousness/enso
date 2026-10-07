// The Input tab: the outline of the input document, what keeps the request
// from being built, and the inspector of the selected frame.

import { Locate } from "lucide-react";
import { useInputStore } from "@/stores/inputStore";
import { useUiStore } from "@/stores/uiStore";
import { useModelCapabilities } from "@/hooks/useModelCapabilities";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SectionDivider } from "@/components/ui/section-leader";
import { useOutline } from "@/inputs/useOutline";
import { revealFrame } from "@/inputs/reveal";
import { outlineEntry, type Outline } from "@/lib/inputs/outline";
import {
  controlTypeLabel,
  fixLabel,
  positionLabel,
  problemText,
  roleLabel,
} from "@/lib/inputs/text";
import { AddFrameMenu } from "./input/AddFrameMenu";
import { FrameInspector } from "./input/FrameInspector";
import { OutlineList } from "./input/OutlineList";

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** "2 of 10 images, 1 control": what goes out, against the model's limit. */
function summaryText(outline: Outline, limit: number | null): string {
  const images = outline.sent.length;
  const parts = [
    limit === null ? count(images, "image", "images") : `${images} of ${limit} images`,
  ];
  if (outline.controls.length > 0)
    parts.push(count(outline.controls.length, "control", "controls"));
  if (outline.ipAdapters.length > 0) {
    parts.push(count(outline.ipAdapters.length, "IP-Adapter", "IP-Adapters"));
  }
  return parts.join(", ");
}

export function InputTab() {
  const outline = useOutline();
  const selectedFrameId = useInputStore((s) => s.selectedFrameId);
  const selectedRole = useInputStore((s) => {
    const frame = s.frames.find((f) => f.id === s.selectedFrameId);
    return frame
      ? frame.role === "control"
        ? controlTypeLabel(frame.control.type)
        : roleLabel(frame.role)
      : null;
  });
  const fixProblem = useInputStore((s) => s.fixProblem);
  const reprocessOnGenerate = useUiStore((s) => s.reprocessOnGenerate);
  const setAutoUpdateProcessed = useUiStore((s) => s.setAutoUpdateProcessed);
  const { maxInputImages } = useModelCapabilities();
  const lockedType = outline.controls[0]?.settings.type ?? null;
  const problem = outline.problems[0];
  const selected = selectedFrameId ? outlineEntry(outline, selectedFrameId) : undefined;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between">
        <Label
          className="text-2xs text-muted-foreground"
          title="When on, processors run fresh every generation. When off, processed maps are sent as they are."
        >
          Re-process on generate
        </Label>
        <Switch checked={reprocessOnGenerate} onCheckedChange={setAutoUpdateProcessed} />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          Inputs
        </span>
        <span className="font-mono text-2xs tabular-nums text-foreground">
          {summaryText(outline, maxInputImages)}
        </span>
      </div>

      <OutlineList outline={outline} />

      {/* Fixed height, so the list does not move when a problem appears */}
      <div className="flex h-6 items-center gap-2">
        {problem && (
          <>
            <p
              className="min-w-0 flex-1 truncate text-3xs text-amber-500"
              title={problemText(problem)}
            >
              {problemText(problem)}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="h-5 shrink-0 rounded px-1.5 text-3xs"
              onClick={() => fixProblem(problem)}
            >
              {fixLabel(problem)}
            </Button>
          </>
        )}
      </div>

      <AddFrameMenu lockedType={lockedType} />

      {selected && selectedRole && (
        <>
          <SectionDivider />
          <div className="flex items-center justify-between">
            <span className="text-2xs font-medium">
              {positionLabel(selected.position)}
              <span className="text-muted-foreground"> · {selectedRole}</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-3xs text-muted-foreground"
              onClick={() => revealFrame(selected.frameId)}
              title="Bring this frame into view on the canvas"
            >
              <Locate size={11} />
              Show on canvas
            </Button>
          </div>
          <FrameInspector frameId={selected.frameId} />
        </>
      )}
    </div>
  );
}
