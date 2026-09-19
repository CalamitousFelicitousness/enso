/** Alpha at or above which a pixel belongs to a mask region. */
export const MASK_ALPHA_THRESHOLD = 10;

export interface LabeledRegion {
  label: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Pixels in the region. */
  area: number;
  /** RGBA, width x height: white with the source alpha inside the region,
   * transparent elsewhere (other regions inside the box included). */
  pixels: Uint8ClampedArray<ArrayBuffer>;
}

export interface LabelResult {
  /** Per frame pixel: the region label, or 0. */
  labels: Int32Array;
  regions: LabeledRegion[];
}

/** 4-connected component labeling over an RGBA buffer's alpha channel. */
export function labelComponents(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = MASK_ALPHA_THRESHOLD,
): LabelResult {
  const total = width * height;
  const labels = new Int32Array(total);
  // Every pixel is pushed at most once (it is labeled when pushed).
  const stack = new Int32Array(total);
  const bounds: {
    label: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    area: number;
  }[] = [];
  let nextLabel = 1;

  for (let i = 0; i < total; i++) {
    if (labels[i] !== 0 || data[i * 4 + 3] < alphaThreshold) continue;
    const label = nextLabel++;
    labels[i] = label;
    let sp = 0;
    stack[sp++] = i;
    let minX = i % width;
    let minY = (i - minX) / width;
    let maxX = minX;
    let maxY = minY;
    let area = 0;

    while (sp > 0) {
      const curr = stack[--sp];
      area++;
      const cx = curr % width;
      const cy = (curr - cx) / width;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;

      if (cx > 0 && labels[curr - 1] === 0 && data[(curr - 1) * 4 + 3] >= alphaThreshold) {
        labels[curr - 1] = label;
        stack[sp++] = curr - 1;
      }
      if (cx < width - 1 && labels[curr + 1] === 0 && data[(curr + 1) * 4 + 3] >= alphaThreshold) {
        labels[curr + 1] = label;
        stack[sp++] = curr + 1;
      }
      if (cy > 0 && labels[curr - width] === 0 && data[(curr - width) * 4 + 3] >= alphaThreshold) {
        labels[curr - width] = label;
        stack[sp++] = curr - width;
      }
      if (
        cy < height - 1 &&
        labels[curr + width] === 0 &&
        data[(curr + width) * 4 + 3] >= alphaThreshold
      ) {
        labels[curr + width] = label;
        stack[sp++] = curr + width;
      }
    }

    bounds.push({ label, minX, minY, maxX, maxY, area });
  }

  const regions: LabeledRegion[] = bounds.map((b) => {
    const w = b.maxX - b.minX + 1;
    const h = b.maxY - b.minY + 1;
    const pixels = new Uint8ClampedArray(w * h * 4);
    for (let y = b.minY; y <= b.maxY; y++) {
      for (let x = b.minX; x <= b.maxX; x++) {
        const src = y * width + x;
        if (labels[src] !== b.label) continue;
        const dst = ((y - b.minY) * w + (x - b.minX)) * 4;
        pixels[dst] = 255;
        pixels[dst + 1] = 255;
        pixels[dst + 2] = 255;
        pixels[dst + 3] = data[src * 4 + 3];
      }
    }
    return { label: b.label, x: b.minX, y: b.minY, width: w, height: h, area: b.area, pixels };
  });

  return { labels, regions };
}
