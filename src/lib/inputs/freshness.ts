// Whether a processed picture is current. A map is named by a key made from
// content: the picture as the processor sees it, the processor with every
// parameter, and the runner's revision. Freshness is derived from the key,
// never remembered, so a picture moved and moved back is current again.

import type { JsonValue, Picture, PlacedPicture, ProcessorSpec, Size, Transform } from "./types";

/** The picture a processor runs on, as content. A file is its bytes; a
 * composite is its layers as placed, the frame they are placed in, and the
 * size it is sent at when the browser resizes it first. */
export type PictureSpec =
  | { kind: "file"; cid: string }
  | {
      kind: "composite";
      width: number;
      height: number;
      out: Size | null;
      layers: { cid: string; transform: Transform; opacity: number }[];
    };

/** Placements below these steps are the same picture: 0.01 px, 1e-4 scale,
 * 0.01 degrees. A refit that moves a layer by less changes no map. */
const POSITION_STEP = 0.01;
const SCALE_STEP = 0.0001;
const ROTATION_STEP = 0.01;

function quantise(value: number, step: number): number {
  const rounded = Math.round(value / step) * step;
  // the decimals of the step, so 0.1 + 0.2 reads as 0.3 and -0 as 0
  const fixed = Number(rounded.toFixed(Math.max(0, -Math.floor(Math.log10(step)))));
  return fixed === 0 ? 0 : fixed;
}

function quantised(t: Transform): Transform {
  return {
    x: quantise(t.x, POSITION_STEP),
    y: quantise(t.y, POSITION_STEP),
    scaleX: quantise(t.scaleX, SCALE_STEP),
    scaleY: quantise(t.scaleY, SCALE_STEP),
    rotation: quantise(t.rotation, ROTATION_STEP),
  };
}

export function fileSpec(picture: Pick<Picture, "cid">): PictureSpec {
  return { kind: "file", cid: picture.cid };
}

export function compositeSpec(layers: PlacedPicture[], frame: Size, out: Size | null): PictureSpec {
  const same = out !== null && out.width === frame.width && out.height === frame.height;
  return {
    kind: "composite",
    width: frame.width,
    height: frame.height,
    out: same ? null : out,
    layers: layers.map((p) => ({
      cid: p.cid,
      transform: quantised(p.transform),
      opacity: quantise(p.opacity, SCALE_STEP),
    })),
  };
}

/** The processor's parameters as sent: the frame's values over the server's
 * defaults, so a default that changes on the server changes the key. */
export function completeParams(
  processor: ProcessorSpec,
  defaults: Record<string, JsonValue> | undefined,
): Record<string, JsonValue> {
  return { ...defaults, ...processor.params };
}

/** JSON with object keys in order, so equal values give equal text. */
function canonical(value: JsonValue | PictureSpec | Record<string, JsonValue>): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );
}

/** The name of the map a processor makes from a picture. */
export function mapKey(
  spec: PictureSpec,
  processor: ProcessorSpec,
  params: Record<string, JsonValue>,
  revision: string,
): string {
  return `${processor.id}|${revision}|${canonical(params)}|${canonical(spec)}`;
}
