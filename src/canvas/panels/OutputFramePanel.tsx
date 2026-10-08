// The Output frame's dock: the selected result's facts, download, and send to an input frame.

import { useCallback, useMemo, useState } from "react";
import { ArrowLeftFromLine, Download, Layers, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGenerationStore } from "@/stores/generationStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { addFilesToInputs } from "@/inputs/route";
import { downloadImage, generateImageFilename, resolveImageSrc } from "@/lib/utils";
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
  const [activeTab, setActiveTab] = useState<"info" | "params">("info");

  const selectedResult = useMemo(
    () => results.find((r) => r.id === selectedResultId),
    [results, selectedResultId],
  );

  const hasSelectedImage =
    selectedResult !== undefined &&
    selectedImageIndex !== null &&
    selectedResult.images[selectedImageIndex] !== undefined;

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
    const imageUrl = selectedResult.images[selectedImageIndex];
    if (!imageUrl) return;
    const resp = await fetch(imageUrl);
    const blob = await resp.blob();
    await addFilesToInputs([new File([blob], "from-output.png", { type: "image/png" })]);
  }, [selectedResult, selectedImageIndex]);

  const handleDownload = useCallback(() => {
    if (!selectedResult || selectedImageIndex === null) return;
    const raw = selectedResult.images[selectedImageIndex];
    if (!raw) return;
    const src = resolveImageSrc(raw);
    const filename = generateImageFilename(selectedResult.info, selectedImageIndex);
    void downloadImage(src, filename);
  }, [selectedResult, selectedImageIndex]);

  const actions = (
    <>
      <JobWarnings warnings={selectedResult?.warnings} />
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
        onClick={() => void handleSendToInput()}
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
