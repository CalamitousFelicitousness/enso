import { describe, expect, it } from "vitest";
import type { SentInput } from "@/lib/inputs/outline";
import type { FrameRole } from "@/lib/inputs/types";
import { planInputs, type InputPlanContext } from "./inputPlan";

function slot(
  role: FrameRole,
  n: number,
  size = { width: 640, height: 480 },
  masked = false,
): SentInput {
  return {
    address: { kind: "image", n },
    frameId: `f${n}`,
    role,
    pictureId: role === "reference" ? `p${n}` : null,
    ...size,
    masked,
    unreadable: false,
  };
}

function context(sent: SentInput[], patch: Partial<InputPlanContext> = {}): InputPlanContext {
  return {
    sent,
    frame: { width: 1024, height: 768 },
    sizeMode: "fixed",
    autoFit: false,
    scaleFactor: 1,
    megapixelTarget: 1,
    sizeMultiple: 8,
    maxInputImages: 1,
    requestSetsSize: false,
    referenceSets: true,
    sendsControlUnits: false,
    sendsControlPictures: false,
    checkpointOverride: false,
    batchCount: 1,
    batchSize: 1,
    ...patch,
  };
}

// An edit model: the request sets the size, and the canvas knew it
const edit = { maxInputImages: 3, requestSetsSize: true, referenceSets: false, sizeMultiple: 16 };

describe("planInputs", () => {
  it("sends nothing for an empty canvas", () => {
    expect(planInputs(context([]))).toEqual({ ok: true, plan: { transport: "none" } });
  });

  it("sends one Initial frame as img2img at the frame size", () => {
    expect(planInputs(context([slot("initial", 1)]))).toEqual({
      ok: true,
      plan: {
        transport: "img2img",
        target: { width: 1024, height: 768 },
        serverResize: false,
        separateInit: false,
      },
    });
  });

  it("sends the init separately when control units bring their own pictures", () => {
    expect(planInputs(context([slot("initial", 1)], { sendsControlPictures: true }))).toEqual({
      ok: true,
      plan: {
        transport: "img2img",
        target: { width: 1024, height: 768 },
        serverResize: false,
        separateInit: true,
      },
    });
  });

  it("has the server resize when Scale changes the generation size", () => {
    const ctx = context([slot("initial", 1)], {
      autoFit: true,
      sizeMode: "scale",
      scaleFactor: 1.5,
    });
    expect(planInputs(ctx)).toEqual({
      ok: true,
      plan: {
        transport: "img2img",
        target: { width: 1536, height: 1152 },
        serverResize: true,
        separateInit: false,
      },
    });
  });

  it("ignores Scale while Fit is off", () => {
    const ctx = context([slot("initial", 1)], { sizeMode: "scale", scaleFactor: 1.5 });
    expect(planInputs(ctx)).toMatchObject({ plan: { target: { width: 1024, height: 768 } } });
  });

  it("has the server resize when the model keeps a coarser size multiple", () => {
    const ctx = context([slot("initial", 1)], {
      frame: { width: 1010, height: 770 },
      sizeMultiple: 16,
    });
    expect(planInputs(ctx)).toEqual({
      ok: true,
      plan: {
        transport: "img2img",
        target: { width: 1008, height: 768 },
        serverResize: true,
        separateInit: false,
      },
    });
  });

  it("sends a lone Reference raw at its own size on a model that sizes from the image", () => {
    const ctx = context([slot("reference", 1, { width: 700, height: 500 })]);
    expect(planInputs(ctx)).toEqual({
      ok: true,
      plan: { transport: "reference", size: { width: 704, height: 504 } },
    });
  });

  it("sends a lone Reference as a set of one where the request sets the size", () => {
    const ctx = context([slot("reference", 1, { width: 700, height: 500 })], edit);
    expect(planInputs(ctx)).toEqual({
      ok: true,
      plan: { transport: "set", target: { width: 1024, height: 768 }, batchCount: 1 },
    });
  });

  it("keeps the size the canvas showed when the model turns out to set it from the request", () => {
    const ctx = context([slot("reference", 1, { width: 700, height: 500 })], {
      ...edit,
      referenceSets: true,
    });
    expect(planInputs(ctx)).toMatchObject({
      plan: { transport: "set", target: { width: 704, height: 512 } },
    });
  });

  it("refuses once when the canvas showed the Size set and the model sizes from the image", () => {
    const ctx = context([slot("reference", 1, { width: 700, height: 500 })], {
      referenceSets: false,
    });
    expect(planInputs(ctx)).toEqual({
      ok: false,
      refusal:
        "The loaded model generates at the size of its input image, 704×504, and Size now shows that. Generate again to use it.",
    });
  });

  it("sends several slots as one set and folds the batch into the count", () => {
    const ctx = context([slot("reference", 1), slot("reference", 2), slot("initial", 3)], {
      ...edit,
      batchCount: 3,
      batchSize: 2,
    });
    expect(planInputs(ctx)).toEqual({
      ok: true,
      plan: { transport: "set", target: { width: 1024, height: 768 }, batchCount: 6 },
    });
  });

  it("refuses more images than the model takes", () => {
    const slots = [1, 2, 3, 4].map((n) => slot("reference", n));
    expect(planInputs(context(slots, edit))).toEqual({
      ok: false,
      refusal: "The loaded model takes up to 3 input images; the canvas holds 4.",
    });
  });

  it("names a single-image limit in words", () => {
    const ctx = context([slot("reference", 1), slot("reference", 2)]);
    expect(planInputs(ctx)).toMatchObject({
      refusal: "The loaded model takes one input image; the canvas holds 2.",
    });
  });

  it("refuses settings the server applies only to a processed input", () => {
    const ctx = context([slot("initial", 1, undefined, true), slot("reference", 2)], {
      ...edit,
      sendsControlUnits: true,
      checkpointOverride: true,
    });
    expect(planInputs(ctx)).toEqual({
      ok: false,
      refusal: "Not available with several input images: mask, control units, checkpoint override.",
    });
  });

  it("words the refusal for a lone Reference sent as a set", () => {
    const ctx = context([slot("reference", 1)], { ...edit, sendsControlUnits: true });
    expect(planInputs(ctx)).toMatchObject({
      refusal: "Not available with a Reference image: control units.",
    });
  });

  it("reports the limit and the conflicting settings together", () => {
    const slots = [1, 2, 3, 4].map((n) => slot("reference", n));
    const ctx = context(slots, { ...edit, sendsControlUnits: true });
    expect(planInputs(ctx)).toMatchObject({
      refusal:
        "The loaded model takes up to 3 input images; the canvas holds 4. Not available with several input images: control units.",
    });
  });
});
