// WYSIWYG request assembly - bridges the canvas UI state and the backend API.
//
// For img2img: visible canvas layers are flattened into a single image at frame
// resolution via flattenCanvas(), then uploaded as the init image. The backend
// receives exactly what the user sees inside the generation frame. Several
// input pictures go out as one condition set in the order the outline numbers
// them; Control and IP-Adapter frames go out as the outline lists them.
// See flattenCanvas.ts and resize.ts for the compositing and resize pipeline.

import { useGenerationStore } from "@/stores/generationStore";
import type { GenerationState } from "@/stores/generationStore";
import { useScriptStore } from "@/stores/scriptStore";
import { useImg2ImgStore } from "@/stores/img2imgStore";
import { useInputStore } from "@/stores/inputStore";
import { useUiStore } from "@/stores/uiStore";
import { exportMask } from "@/lib/exportMask";
import { flattenCanvas } from "@/lib/flattenCanvas";
import { uploadBlob } from "@/lib/upload";
import { resizeBlob } from "@/lib/resize";
import {
  computeOutline,
  type ControlSend,
  type IpAdapterSend,
  type SentInput,
} from "@/lib/inputs/outline";
import {
  CONTROL_PICTURE_SERVER_TEXT,
  problemText,
  unreadableControlText,
  unreadableText,
} from "@/lib/inputs/text";
import { composedPictures, type Frame, type Picture, type Size } from "@/lib/inputs/types";
import type { ControlRequest } from "@/api/types/generation";
import type { DetailerMode } from "@/api/types/models";
import { BACKEND_UNIT_TYPE } from "@/api/types/control";
import { generationParams } from "./generateParams";
import { planInputs } from "./inputPlan";

type ControlUnitWire = NonNullable<ControlRequest["control"]>[number];
type IpAdapterWire = NonNullable<ControlRequest["ip_adapter"]>[number];

export interface BuildResult {
  request: ControlRequest;
}

export interface ControlBuildOptions {
  /** Most input images the loaded model takes in one request; null when unknown. */
  maxInputImages: number | null;
  /** The request sets the loaded pipeline's output size, also from one input image. */
  requestSetsSize: boolean | null;
  /** Width and height multiple the loaded model keeps a size at. */
  sizeMultiple: number;
  /** The canvas showed a lone Reference at the image's size, from the model
   * it knew before any load for this job (referenceSetsSize). */
  referenceSets: boolean;
  /** An image-to-image pass on the loaded pipeline takes a denoising strength. */
  strengthSupported: boolean;
  /** How the detailer runs on the loaded pipeline, "none" when it cannot;
   * null when unknown. */
  detailerMode: DetailerMode | null;
  /** The server's sdnext leaves a control unit its own picture beside a separate
   * init image (server-info `capabilities.control_separate_init`); null when unknown. */
  controlSeparateInit: boolean | null;
  /** The loaded checkpoint carries its control model, so a ControlNet frame
   * needs none (`control_unified` on /sdapi/v2/checkpoint); null when unknown. */
  controlUnified: boolean | null;
}

/** The canvas holds inputs the loaded model cannot take as they are. */
export class InputRefusal extends Error {
  override name = "InputRefusal";
}

/** The frame a sent picture belongs to. */
function frameOf(frames: Frame[], input: SentInput): Frame {
  const frame = frames.find((f) => f.id === input.frameId);
  if (!frame) throw new Error("An input frame is gone");
  return frame;
}

/** The picture a Reference frame sends, with its bytes. */
function fileOf(frames: Frame[], input: SentInput): Picture & { file: Blob } {
  const picture = frameOf(frames, input).pictures.find((p) => p.id === input.pictureId);
  if (!picture?.file) throw new Error("A reference picture could not be read");
  return { ...picture, file: picture.file };
}

/** Several pictures as one condition set, in the order sent: Initial frames
 * flattened and resized to the output size here, references raw. */
async function uploadConditionSet(
  sent: SentInput[],
  frames: Frame[],
  gen: GenerationState,
  target: Size,
): Promise<string[]> {
  const refs: string[] = [];
  for (const input of sent) {
    if (input.role === "reference") {
      const picture = fileOf(frames, input);
      refs.push(await uploadBlob(picture.file, picture.name));
      continue;
    }
    const layers = composedPictures(frameOf(frames, input));
    const flat = await flattenCanvas(layers, gen.width, gen.height);
    if (!flat) throw new Error("Failed to flatten an input frame");
    refs.push(await uploadBlob(await resizeBlob(flat, target.width, target.height), "input.png"));
  }
  return refs;
}

/** A Control frame as a control unit: its source frame's composition at the
 * generation size as the unit's own picture. A processed map stands in for
 * the picture, unprocessed, unless the job processes afresh. */
async function controlUnit(
  send: ControlSend,
  frames: Frame[],
  frame: Size,
  target: Size,
  reprocess: boolean,
): Promise<ControlUnitWire> {
  const source = frames.find((f) => f.id === send.sourceFrameId);
  if (!source) throw new Error("A control frame's source is gone");
  const s = send.settings;
  const map = reprocess ? null : send.processed?.blob;
  let override: string;
  if (map) {
    override = await uploadBlob(map, "processed.png");
  } else {
    const flat = await flattenCanvas(composedPictures(source), frame.width, frame.height, target);
    if (!flat) throw new Error("Failed to flatten a control frame");
    override = await uploadBlob(flat, "control.png");
  }
  return {
    process: map ? "None" : s.process,
    model: s.model,
    strength: s.strength,
    start: s.start,
    end: s.end,
    override,
    unit_type: BACKEND_UNIT_TYPE[s.type] ?? s.type,
    mode: s.mode,
    ...(s.type === "controlnet" ? { guess: s.guess } : {}),
    ...(s.type === "t2i" ? { factor: s.factor } : {}),
    ...(s.type === "style_transfer"
      ? {
          attention: s.attention,
          fidelity: s.fidelity,
          query_weight: s.queryWeight,
          adain_weight: s.adainWeight,
        }
      : {}),
    ...(Object.keys(s.processParams).length > 0 && !map ? { process_params: s.processParams } : {}),
  };
}

/** An IP-Adapter frame as an adapter unit: its pictures raw, in order, with
 * the region masks it holds. */
async function ipAdapterUnit(send: IpAdapterSend, frames: Frame[]): Promise<IpAdapterWire> {
  const frame = frames.find((f) => f.id === send.frameId);
  if (!frame) throw new Error("An IP-Adapter frame is gone");
  const pictures = send.pictureIds.flatMap((id) => {
    const picture = frame.pictures.find((p) => p.id === id);
    return picture?.file ? [{ file: picture.file, name: picture.name }] : [];
  });
  const masks = send.settings.masks.flatMap((m) =>
    m.file ? [{ file: m.file, name: m.name }] : [],
  );
  const images = await Promise.all(pictures.map((p) => uploadBlob(p.file, p.name)));
  const maskRefs = await Promise.all(masks.map((m) => uploadBlob(m.file, m.name)));
  return {
    adapter: send.settings.adapter,
    scale: send.settings.scale,
    crop: send.settings.crop,
    start: send.settings.start,
    end: send.settings.end,
    images,
    ...(maskRefs.length > 0 ? { masks: maskRefs } : {}),
  };
}

export async function buildControlRequest({
  maxInputImages,
  requestSetsSize,
  sizeMultiple,
  referenceSets,
  strengthSupported,
  detailerMode,
  controlSeparateInit,
  controlUnified,
}: ControlBuildOptions): Promise<BuildResult> {
  const gen = useGenerationStore.getState();
  const scripts = useScriptStore.getState();
  const img2img = useImg2ImgStore.getState();
  const { frames } = useInputStore.getState();
  const ui = useUiStore.getState();

  const request = generationParams(gen, {
    livePreviews: ui.livePreviews,
    sizeMultiple,
    requestSetsSize,
    strengthSupported,
    detailerMode,
    scripts,
  });

  // What the frames send, in the order the canvas numbers it
  const outline = computeOutline(frames, { controlUnified: controlUnified === true });
  const unreadable = unreadableText(outline.entries) ?? unreadableControlText(outline);
  if (unreadable) throw new InputRefusal(unreadable);
  const problem = outline.problems[0];
  if (problem) throw new InputRefusal(problemText(problem));
  const { sent, controls, ipAdapters } = outline;
  const planned = planInputs({
    sent,
    frame: { width: gen.width, height: gen.height },
    sizeMode: img2img.sizeMode,
    autoFit: ui.autoFitFrame,
    scaleFactor: img2img.scaleFactor,
    megapixelTarget: img2img.megapixelTarget,
    sizeMultiple,
    maxInputImages,
    requestSetsSize,
    referenceSets,
    sendsControlUnits: controls.length > 0 || ipAdapters.length > 0,
    sendsControlPictures: controls.length > 0,
    checkpointOverride: "sd_model_checkpoint" in gen.overrideSettings,
    batchCount: gen.batchCount,
    batchSize: gen.batchSize,
  });
  if (!planned.ok) throw new InputRefusal(planned.refusal);
  const { plan } = planned;
  // An older sdnext would hand the ControlNet the init image in place of the unit's picture
  if (plan.transport === "img2img" && plan.separateInit && controlSeparateInit === false) {
    throw new InputRefusal(CONTROL_PICTURE_SERVER_TEXT);
  }

  const frame: Size = { width: gen.width, height: gen.height };
  // Control pictures go out at the size the model generates at
  const controlTarget: Size =
    plan.transport === "img2img" || plan.transport === "set"
      ? plan.target
      : plan.transport === "reference"
        ? plan.size
        : frame;

  if (ipAdapters.length > 0) {
    request.ip_adapter = await Promise.all(ipAdapters.map((send) => ipAdapterUnit(send, frames)));
  }
  if (controls.length > 0) {
    request.control = await Promise.all(
      controls.map((send) =>
        controlUnit(send, frames, frame, controlTarget, ui.reprocessOnGenerate),
      ),
    );
  }

  const primary: SentInput | undefined = sent[0];
  if (plan.transport === "set") {
    request.inputs = await uploadConditionSet(sent, frames, gen, plan.target);
    request.skip_processing = true;
    request.input_type = 1;
    request.width_before = plan.target.width;
    request.height_before = plan.target.height;
    request.batch_count = plan.batchCount;
    request.batch_size = 1;
  } else if (plan.transport === "reference" && primary?.role === "reference") {
    // The source file as it is
    const picture = fileOf(frames, primary);
    request.inputs = [await uploadBlob(picture.file, picture.name)];
    request.input_type = 1;
    request.width_before = plan.size.width;
    request.height_before = plan.size.height;
  } else if (plan.transport === "img2img" && primary?.role === "initial") {
    // img2img: add inputs, mask, inpainting params
    request.width_before = plan.target.width;
    request.height_before = plan.target.height;

    // Flatten the frame's pictures at full frame size.
    const source = frameOf(frames, primary);
    const flattenedBlob = await flattenCanvas(composedPictures(source), frame.width, frame.height);
    if (flattenedBlob) {
      if (plan.separateInit) {
        // Control units bring their own pictures: the init travels separately (input_type 2),
        // resized here because sdnext resizes a separate init with its global upscaler.
        // inputs repeats it so sdnext still sizes the unit pictures against it.
        const init = plan.serverResize
          ? await resizeBlob(flattenedBlob, plan.target.width, plan.target.height)
          : flattenedBlob;
        const ref = await uploadBlob(init, "input.png");
        request.inputs = [ref];
        request.inits = [ref];
        request.input_type = 2;
      } else {
        request.inputs = [await uploadBlob(flattenedBlob, "input.png")];
        request.input_type = 1;
        // Force resize_mode_before=1 (Fixed) + resize_name_before so the backend
        // resizes the init image to the generation size.
        // Both fields are required: run.py zeros resize_mode when resize_name is 'None'.
        if (plan.serverResize) {
          request.resize_mode_before = 1;
          request.resize_name_before = img2img.resizeMethod;
        }
      }
    }

    // Composite the frame's mask objects + any strokes not baked yet.
    const maskBlob = await exportMask(
      source.mask.objects,
      source.mask.strokes,
      frame.width,
      frame.height,
    );
    if (maskBlob) {
      request.mask = await uploadBlob(maskBlob, "mask.png");
      request.mask_blur = img2img.maskBlur;
      request.inpaint_full_res = img2img.inpaintFullRes;
      request.inpaint_full_res_padding = img2img.inpaintFullResPadding;
      request.inpainting_mask_invert = img2img.inpaintingMaskInvert ? 1 : 0;
      request.mask_apply_overlay = img2img.maskApplyOverlay;
      request.inpainting_mask_weight = img2img.inpaintingMaskWeight;
    }
  }

  // User override settings (merged last to take priority)
  if (Object.keys(gen.overrideSettings).length > 0) {
    request.extra = {
      ...request.extra,
      ...gen.overrideSettings,
    };
  }

  return { request };
}
