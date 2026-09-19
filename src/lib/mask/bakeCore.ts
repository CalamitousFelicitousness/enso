// Rasterises a frame's mask layers plus new strokes and splits the result
// into connected regions. Runs in the bake worker, or on the main thread
// when no worker is available; it touches nothing outside OffscreenCanvas.

import { labelComponents, MASK_ALPHA_THRESHOLD } from "./components";
import { placedBounds } from "./geometry";
import type { RegionOverlap } from "./identity";
import type { BakeInput, BakeOutput, BakedRegion, MaskSource } from "./protocol";
import type { MaskLine } from "@/stores/canvasStore";

type Ctx = OffscreenCanvasRenderingContext2D;

function context2d(width: number, height: number): Ctx {
  const ctx = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
  return ctx;
}

function drawMask(ctx: Ctx, mask: MaskSource, image: ImageBitmap) {
  ctx.save();
  ctx.translate(mask.x, mask.y);
  ctx.rotate((mask.rotation * Math.PI) / 180);
  ctx.scale(mask.scaleX, mask.scaleY);
  ctx.drawImage(image, 0, 0, mask.width, mask.height);
  ctx.restore();
}

/** Only alpha matters downstream: brushes add coverage, erasers cut it. */
function drawStrokes(ctx: Ctx, lines: MaskLine[]) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "#fff";
  for (const line of lines) {
    const pts = line.points;
    if (pts.length < 4) continue;
    ctx.globalCompositeOperation = line.tool === "eraser" ? "destination-out" : "source-over";
    ctx.lineWidth = line.strokeWidth;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
}

/** Which mask each frame pixel belonged to before the strokes, as an index
 * into `masks`, or -1. Where masks overlap the later one wins. */
function ownerMap(
  masks: MaskSource[],
  images: ImageBitmap[],
  width: number,
  height: number,
): Int32Array {
  const owner = new Int32Array(width * height).fill(-1);
  masks.forEach((mask, i) => {
    const b = placedBounds(mask, width, height);
    if (!b) return;
    const ctx = context2d(b.width, b.height);
    ctx.translate(-b.x, -b.y);
    drawMask(ctx, mask, images[i]);
    const data = ctx.getImageData(0, 0, b.width, b.height).data;
    for (let y = 0; y < b.height; y++) {
      for (let x = 0; x < b.width; x++) {
        if (data[(y * b.width + x) * 4 + 3] >= MASK_ALPHA_THRESHOLD) {
          owner[(b.y + y) * width + b.x + x] = i;
        }
      }
    }
  });
  return owner;
}

function parseColor(rgb: string): [number, number, number] {
  return [
    parseInt(rgb.slice(1, 3), 16),
    parseInt(rgb.slice(3, 5), 16),
    parseInt(rgb.slice(5, 7), 16),
  ];
}

export async function bakeMasks(input: BakeInput): Promise<BakeOutput> {
  const { width, height, masks, lines } = input;
  const images = await Promise.all(masks.map((m) => createImageBitmap(m.blob)));

  const ctx = context2d(width, height);
  masks.forEach((mask, i) => drawMask(ctx, mask, images[i]));
  const owner = masks.length > 0 ? ownerMap(masks, images, width, height) : null;
  drawStrokes(ctx, lines);
  const { labels, regions } = labelComponents(
    ctx.getImageData(0, 0, width, height).data,
    width,
    height,
  );
  for (const image of images) image.close();

  const [r, g, b] = parseColor(input.color);
  const out: BakedRegion[] = [];
  for (const region of regions) {
    const counts = new Map<number, number>();
    if (owner) {
      for (let y = 0; y < region.height; y++) {
        for (let x = 0; x < region.width; x++) {
          const idx = (region.y + y) * width + region.x + x;
          if (labels[idx] !== region.label) continue;
          const o = owner[idx];
          if (o >= 0) counts.set(o, (counts.get(o) ?? 0) + 1);
        }
      }
    }
    const overlaps: RegionOverlap[] = [...counts]
      .map(([i, pixels]) => ({ id: masks[i].id, pixels }))
      .sort((a, b) => b.pixels - a.pixels);

    const px = region.pixels;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] > 0) {
        px[i] = r;
        px[i + 1] = g;
        px[i + 2] = b;
      }
    }
    const imageData = new ImageData(px, region.width, region.height);
    const regionCanvas = new OffscreenCanvas(region.width, region.height);
    regionCanvas.getContext("2d")?.putImageData(imageData, 0, 0);
    const [blob, bitmap] = await Promise.all([
      regionCanvas.convertToBlob({ type: "image/png" }),
      createImageBitmap(imageData),
    ]);
    out.push({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      area: region.area,
      overlaps,
      blob,
      bitmap,
    });
  }
  return { regions: out };
}
