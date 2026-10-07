// The header flush with a processed map: the composite beside the output, or
// the map under a Control frame. Offers the map for download.

import { useCallback } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadImage } from "@/lib/utils";
import { PROCESSED_COLOR } from "@/canvas/frameColors";
import { FrameHeader } from "./FrameHeader";

interface ProcessedHatProps {
  canvasX: number;
  canvasY?: number;
  viewport: { x: number; y: number; scale: number };
  frameW: number;
  labelScale: number;
  sizeText?: string;
  label?: string;
  /** The map, as a url or as bytes; null when there is none to download. */
  source: string | Blob | null;
}

export function ProcessedHat({
  canvasX,
  canvasY,
  viewport,
  frameW,
  labelScale,
  sizeText,
  label,
  source,
}: ProcessedHatProps) {
  const handleDownload = useCallback(() => {
    if (!source) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const name = `processed_${timestamp}.png`;
    if (typeof source === "string") {
      void downloadImage(source, name);
      return;
    }
    const url = URL.createObjectURL(source);
    void downloadImage(url, name).finally(() => URL.revokeObjectURL(url));
  }, [source]);

  return (
    <FrameHeader
      mode="hat"
      color={PROCESSED_COLOR}
      label={label ?? "Processed"}
      sizeText={sizeText}
      canvasX={canvasX}
      canvasY={canvasY}
      frameW={frameW}
      viewport={viewport}
      labelScale={labelScale}
      actions={
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleDownload}
          disabled={!source}
          title="Download processed image"
          className="text-muted-foreground hover:bg-white/5 disabled:opacity-30"
        >
          <Download size={14} />
        </Button>
      }
    />
  );
}
