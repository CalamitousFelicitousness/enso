// The Output frame's dock: the selected result's facts, download, and send to an input frame.

import { useCallback, useMemo, useState } from "react";
import {
  ArchiveRestore,
  ArrowLeftFromLine,
  Download,
  ImageOff,
  Layers,
  SlidersHorizontal,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGenerationStore } from "@/stores/generationStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { useRestoreDialogStore } from "@/stores/restoreDialogStore";
import { RESTORE_RESULT_TITLE } from "@/lib/jobs/text";
import { addServerPictures } from "@/inputs/route";
import { resultPicture } from "@/inputs/adopt";
import { generateImageFilename } from "@/lib/utils";
import { restoreTrashed, useOutputFileState } from "@/api/hooks/useGalleryTrash";
import type { OutputFileState } from "@/lib/gallery/trash";
import { useMinute } from "@/hooks/useMinute";
import { DELETED_FROM_TRASH, inTrashChipText, RESTORE, RESTORE_FILE } from "@/lib/gallery/text";
import { downloadMedia, failedWith } from "@/lib/mediaFiles";
import type { GenerationInfo } from "@/api/types/generation";
import { pickedSeeds } from "@/lib/request/restoreParams";
import { JobWarnings } from "@/components/generation/JobWarnings";
import { OUTPUT_COLOR } from "@/canvas/frameColors";
import { DockTab, FrameHeader } from "./FrameHeader";

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`text-[10px] text-foreground ${mono ? "font-mono tabular-nums" : ""}`}>
        {value}
      </span>
    </div>
  );
}

/** The dock's second line while the selected output's file is out of its
 * folder: what became of it, and Restore while it is in the trash. */
function FileTrashLine({ state, now }: { state: NonNullable<OutputFileState>; now: number }) {
  const text =
    state.state === "trashed" ? inTrashChipText(state.expiresAt, now) : DELETED_FROM_TRASH;
  const Glyph = state.state === "trashed" ? Trash2 : ImageOff;
  return (
    <>
      <Glyph size={12} className="shrink-0 text-amber-400" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-amber-400" title={text}>
        {text}
      </span>
      {state.state === "trashed" && (
        <Button
          variant="ghost"
          size="sm"
          className="h-5 shrink-0 gap-1 px-1.5 text-[10px]"
          title={RESTORE_FILE}
          onClick={() => void restoreTrashed([state.item])}
        >
          <Undo2 size={12} /> {RESTORE}
        </Button>
      )}
    </>
  );
}

export function OutputFramePanel({
  canvasX,
  viewport,
  frameW,
  labelScale,
  sizeText,
}: {
  canvasX: number;
  viewport: { x: number; y: number; scale: number };
  frameW: number;
  labelScale: number;
  sizeText: string;
}) {
  const selectedResultId = useGenerationStore((s) => s.selectedResultId);
  const selectedImageIndex = useGenerationStore((s) => s.selectedImageIndex);
  const results = useGenerationStore((s) => s.results);
  const panelCollapsedOverrides = useCanvasStore((s) => s.panelCollapsedOverrides);
  const togglePanelCollapsed = useCanvasStore((s) => s.togglePanelCollapsed);
  const openRestore = useRestoreDialogStore((s) => s.open);
  const [activeTab, setActiveTab] = useState<"info" | "params">("info");

  const selectedResult = useMemo(
    () => results.find((r) => r.id === selectedResultId),
    [results, selectedResultId],
  );

  const hasSelectedImage =
    selectedResult !== undefined &&
    selectedImageIndex !== null &&
    selectedResult.images[selectedImageIndex] !== undefined;

  const fileState = useOutputFileState(
    hasSelectedImage ? selectedResult.images[selectedImageIndex] : undefined,
  );
  const now = useMinute(fileState?.state === "trashed");

  const genInfo = useMemo<GenerationInfo | null>(() => {
    if (!selectedResult?.info) return null;
    try {
      return JSON.parse(selectedResult.info) as GenerationInfo;
    } catch {
      return null;
    }
  }, [selectedResult]);

  // the seed of the image shown, as the server recorded it for that image
  const seed = useMemo(() => {
    if (!selectedResult || !genInfo) return null;
    const picked = pickedSeeds(selectedResult.parameters, genInfo, selectedImageIndex ?? 0).seed;
    return picked >= 0 ? picked : null;
  }, [selectedResult, genInfo, selectedImageIndex]);

  const override = panelCollapsedOverrides.get("output");
  const collapsed = override !== undefined ? override : !hasSelectedImage;

  const handleSendToInput = useCallback(async () => {
    if (!selectedResult || selectedImageIndex === null) return;
    const image = selectedResult.images[selectedImageIndex];
    if (!image) return;
    await addServerPictures([resultPicture(image, "from-output.png")]);
  }, [selectedResult, selectedImageIndex]);

  const handleDownload = useCallback(() => {
    if (!selectedResult || selectedImageIndex === null) return;
    const image = selectedResult.images[selectedImageIndex];
    if (!image) return;
    const filename = generateImageFilename(selectedResult.info, selectedImageIndex);
    downloadMedia(image, filename).catch(failedWith("Could not download the image"));
  }, [selectedResult, selectedImageIndex]);

  const actions = (
    <>
      <JobWarnings warnings={selectedResult?.warnings} />
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => {
          if (selectedResultId && selectedImageIndex !== null) {
            openRestore(selectedResultId, selectedImageIndex);
          }
        }}
        disabled={!hasSelectedImage}
        title={RESTORE_RESULT_TITLE}
        className="text-muted-foreground hover:bg-white/5 disabled:opacity-30"
      >
        <ArchiveRestore size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={handleDownload}
        disabled={!hasSelectedImage}
        title="Download output image"
        className="text-muted-foreground hover:bg-white/5 disabled:opacity-30"
      >
        <Download size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() =>
          void handleSendToInput().catch(failedWith("Could not send the image to the inputs"))
        }
        disabled={!hasSelectedImage}
        title="Send selected output to Input frame"
        className="text-muted-foreground hover:bg-white/5 disabled:opacity-30"
      >
        <ArrowLeftFromLine size={14} />
      </Button>
    </>
  );

  const tabBar = (
    <>
      <DockTab
        active={activeTab === "info"}
        label="Info"
        icon={Layers}
        accent={OUTPUT_COLOR}
        onClick={() => setActiveTab("info")}
      />
      <DockTab
        active={activeTab === "params"}
        label="Options"
        icon={SlidersHorizontal}
        accent={OUTPUT_COLOR}
        onClick={() => setActiveTab("params")}
      />
    </>
  );

  const drawer =
    activeTab === "info" ? (
      <div className="flex flex-col gap-1.5">
        <InfoRow label="Size" value={sizeText} mono />
        {genInfo?.model && <InfoRow label="Model" value={genInfo.model} />}
        {genInfo?.sampler_name && <InfoRow label="Sampler" value={genInfo.sampler_name} />}
      </div>
    ) : (
      <div className="flex flex-col gap-1.5">
        {genInfo?.steps !== undefined && (
          <InfoRow label="Steps" value={String(genInfo.steps)} mono />
        )}
        {genInfo?.cfg_scale !== undefined && (
          <InfoRow label="CFG" value={String(genInfo.cfg_scale)} mono />
        )}
        {seed !== null && <InfoRow label="Seed" value={String(seed)} mono />}
        {!genInfo && <span className="text-[10px] text-muted-foreground">No generation data</span>}
      </div>
    );

  return (
    <FrameHeader
      mode="panel"
      color={OUTPUT_COLOR}
      label="Output"
      sizeText={sizeText}
      statusLine={fileState ? <FileTrashLine state={fileState} now={now} /> : undefined}
      canvasX={canvasX}
      frameW={frameW}
      viewport={viewport}
      labelScale={labelScale}
      actions={actions}
      tabBar={tabBar}
      drawer={drawer}
      collapsed={collapsed}
      onToggleCollapsed={() => togglePanelCollapsed("output", collapsed)}
    />
  );
}
