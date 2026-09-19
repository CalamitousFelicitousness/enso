import type { MaskLine } from "@/stores/canvasStore";
import type { RegionOverlap } from "./identity";

/** A mask layer as the bake reads it. Rotation in degrees, as Konva stores it. */
export interface MaskSource {
  id: string;
  blob: Blob;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export interface BakeInput {
  width: number;
  height: number;
  masks: MaskSource[];
  lines: MaskLine[];
  /** Display colour as #rrggbb; baked into the region pixels. */
  color: string;
}

export interface BakedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  overlaps: RegionOverlap[];
  /** Tinted PNG. */
  blob: Blob;
  /** Same pixels, ready to draw. */
  bitmap: ImageBitmap;
}

export interface BakeOutput {
  regions: BakedRegion[];
}

export interface BakeRequest {
  type: "bake";
  jobId: number;
  input: BakeInput;
}

export type BakeResponse =
  | { type: "bake"; jobId: number; output: BakeOutput }
  | { type: "error"; jobId: number; message: string };
