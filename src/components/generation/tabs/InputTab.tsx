// The Input tab: the outline of the input document, what keeps the request
// from being built, and the inspector of the selected frame.

import { BookmarkPlus, Download, Loader2, Locate, ScrollText } from "lucide-react";
import { useInputStore } from "@/stores/inputStore";
import { useModelCapabilities } from "@/hooks/useModelCapabilities";
import { Button } from "@/components/ui/button";
import { SectionDivider } from "@/components/ui/section-leader";
import { useOutlineWithEnv } from "@/inputs/useOutline";
import { saveFrames, useLibrarySaving } from "@/inputs/library";
import { exportCurrent, saveRecipe } from "@/inputs/recipes";
import {
  EXPORT_CURRENT,
  EXPORT_CURRENT_HINT,
  SAVE_RECIPE,
  SAVE_RECIPE_HINT,
} from "@/lib/recipes/text";
import { applyFix } from "@/inputs/processing";
import { revealFrame } from "@/inputs/reveal";
import { outlineEntry, type Outline } from "@/lib/inputs/outline";
import {
  controlTypeLabel,
  fixLabel,
  positionLabel,
  problemText,
  roleLabel,
  SAVE_FRAME,
  SAVE_FRAME_HINT,
  SAVE_SET,
  SHOW_ON_CANVAS,
  SHOW_ON_CANVAS_HINT,
} from "@/lib/inputs/text";
import { SAVING } from "@/lib/media/text";
import { AddFrameMenu } from "./input/AddFrameMenu";
import { FrameInspector } from "./input/FrameInspector";
import { OutlineList } from "./input/OutlineList";

/** The save icon, turning while a save to the library uploads. */
function SaveIcon({ busy }: { busy: boolean }) {
  return busy ? <Loader2 size={11} className="animate-spin" /> : <BookmarkPlus size={11} />;
}

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
  const { outline, env } = useOutlineWithEnv();
  const selectedFrameId = useInputStore((s) => s.selectedFrameId);
  const selectedRole = useInputStore((s) => {
    const frame = s.frames.find((f) => f.id === s.selectedFrameId);
    return frame
      ? frame.role === "control"
        ? controlTypeLabel(frame.control.type)
        : roleLabel(frame.role)
      : null;
  });
  const { maxInputImages } = useModelCapabilities();
  const saving = useLibrarySaving((s) => s.saving > 0);
  const lockedType = outline.controls[0]?.settings.type ?? null;
  const problem = outline.problems[0];
  const selected = selectedFrameId ? outlineEntry(outline, selectedFrameId) : undefined;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1">
          <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
            Inputs
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            disabled={saving}
            aria-busy={saving || undefined}
            onClick={() => void saveFrames(env, "all")}
            title={saving ? SAVING : SAVE_SET}
            aria-label={SAVE_SET}
          >
            <SaveIcon busy={saving} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            disabled={saving}
            aria-busy={saving || undefined}
            onClick={() => void saveRecipe({ kind: "current" })}
            title={saving ? SAVING : SAVE_RECIPE_HINT}
            aria-label={SAVE_RECIPE}
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <ScrollText size={11} />}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            onClick={() => void exportCurrent()}
            title={EXPORT_CURRENT_HINT}
            aria-label={EXPORT_CURRENT}
          >
            <Download size={11} />
          </Button>
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
              onClick={() => applyFix(env, problem)}
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
            <span className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-3xs text-muted-foreground"
                disabled={saving}
                aria-busy={saving || undefined}
                onClick={() => void saveFrames(env, [selected.frameId])}
                title={saving ? SAVING : SAVE_FRAME_HINT}
              >
                <SaveIcon busy={saving} />
                {SAVE_FRAME}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-3xs text-muted-foreground"
                onClick={() => revealFrame(selected.frameId)}
                title={SHOW_ON_CANVAS_HINT}
              >
                <Locate size={11} />
                {SHOW_ON_CANVAS}
              </Button>
            </span>
          </div>
          <FrameInspector frameId={selected.frameId} />
        </>
      )}
    </div>
  );
}
