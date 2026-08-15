import { useMemo } from "react";
import { useVideoStore } from "@/stores/videoStore";
import { useVideoCanvasStore } from "@/stores/videoCanvasStore";
import { useActiveVideoCaps } from "@/hooks/useActiveVideoCaps";
import { REFERENCE_HEIGHT } from "./useControlFrameLayout";
import {
  REFERENCE_CHILD_GAP,
  REFERENCE_MOTHER_PADDING,
  computeReferenceChildCellSize,
  computeReferenceGridColumns,
  computeReferenceGridRows,
} from "./inputFrameLayout";
import type { ReferenceChildPosition } from "./inputFrameTypes";

const FRAME_GAP = 48;

export interface VideoCanvasLayout {
  showInit: boolean;
  showLast: boolean;
  showReferences: boolean;
  initX: number;
  lastX: number;
  referencesX: number;
  outputX: number;
  /** Child cells local to the references mother frame; wireIndex is the
   * 1-based <Picture N> address. */
  referenceChildren: ReferenceChildPosition[];
  referenceAddCell: { x: number; y: number; w: number; h: number } | null;
  /** Visible-frame count; part of the stage re-fit key so slot changes
   * trigger a re-fit. */
  slotCount: number;
  totalBounds: { minX: number; maxX: number; maxY: number };
  displayScale: number;
  displayW: number;
  displayH: number;
}

export function useVideoFrameLayout(): VideoCanvasLayout {
  const width = useVideoStore((s) => s.width);
  const height = useVideoStore((s) => s.height);
  const references = useVideoCanvasStore((s) => s.references);
  const caps = useActiveVideoCaps();

  const showInit = caps.init_image !== "ignored";
  const showLast = caps.last_image !== "ignored";
  // Only the generic video wire carries references
  const showReferences = caps.references.supported && caps.job_type === "video";
  const maxImages = caps.references.max_images;

  return useMemo(() => {
    const ds = height > 0 ? REFERENCE_HEIGHT / height : 1;
    const dw = width * ds;
    const dh = REFERENCE_HEIGHT;

    let cursor = 0;
    const initX = showInit ? cursor : 0;
    if (showInit) cursor += dw + FRAME_GAP;
    const lastX = showLast ? cursor : 0;
    if (showLast) cursor += dw + FRAME_GAP;
    const referencesX = showReferences ? cursor : 0;
    if (showReferences) cursor += dw + FRAME_GAP;
    const outputX = cursor;

    let referenceChildren: ReferenceChildPosition[] = [];
    let referenceAddCell: VideoCanvasLayout["referenceAddCell"] = null;
    if (showReferences) {
      const count = references.length;
      const includeAdd = count < maxImages;
      const columns = computeReferenceGridColumns(Math.max(1, count));
      const rows = computeReferenceGridRows(count, columns, includeAdd);
      const contentW = dw - 2 * REFERENCE_MOTHER_PADDING;
      const contentH = dh - 2 * REFERENCE_MOTHER_PADDING;
      const { cellW, cellH } = computeReferenceChildCellSize(contentW, contentH, columns, rows);
      const cellAt = (i: number) => ({
        x: REFERENCE_MOTHER_PADDING + (i % columns) * (cellW + REFERENCE_CHILD_GAP),
        y: REFERENCE_MOTHER_PADDING + Math.floor(i / columns) * (cellH + REFERENCE_CHILD_GAP),
      });
      referenceChildren = references.map((r, i) => ({
        refId: r.id,
        ...cellAt(i),
        displayW: cellW,
        displayH: cellH,
        wireIndex: i + 1,
      }));
      if (includeAdd) {
        referenceAddCell = { ...cellAt(count), w: cellW, h: cellH };
      }
    }

    const slotCount = [showInit, showLast, showReferences, true].filter(Boolean).length;

    return {
      showInit,
      showLast,
      showReferences,
      initX,
      lastX,
      referencesX,
      outputX,
      referenceChildren,
      referenceAddCell,
      slotCount,
      totalBounds: { minX: 0, maxX: outputX + dw, maxY: dh },
      displayScale: ds,
      displayW: dw,
      displayH: dh,
    };
  }, [width, height, references, showInit, showLast, showReferences, maxImages]);
}
