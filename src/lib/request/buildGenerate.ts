// WYSIWYG request assembly - bridges the canvas UI state and the backend API.
//
// For img2img: visible canvas layers are flattened into a single image at frame
// resolution via flattenCanvas(), then uploaded as the init image. The backend
// receives exactly what the user sees inside the generation frame. Several
// input pictures go out as one condition set in the order the outline numbers
// them; Control and IP-Adapter frames go out as the outline lists them. A
// processed picture goes out as its map when the cache holds it, else with
// its processor and key for the server to make the map before generating.
// Every picture goes out through the uploader, which records its source.
// See flattenCanvas.ts and resize.ts for the compositing and resize pipeline.

import { useGenerationStore } from "@/stores/generationStore";
import { useScriptStore } from "@/stores/scriptStore";
import { useImg2ImgStore } from "@/stores/img2imgStore";
import { useInputStore } from "@/stores/inputStore";
import { useUiStore } from "@/stores/uiStore";
import { outlineWithMaps } from "@/inputs/maps";
import { createUploader, type Ledger, type Uploader } from "@/inputs/materialise";
import type { ProcessorFacts } from "@/lib/processorUtils";
import {
  computeOutline,
  type ControlSend,
  type IpAdapterSend,
  type MapSlot,
  type SentInput,
} from "@/lib/inputs/outline";
import type { JobInputs } from "@/lib/inputs/stored";
import {
  CONTROL_PICTURE_SERVER_TEXT,
  problemText,
  unreadableControlText,
  unreadableText,
} from "@/lib/inputs/text";
import type { Size } from "@/lib/inputs/types";
import type { ControlRequest } from "@/api/types/generation";
import type { DetailerMode } from "@/api/types/models";
import { BACKEND_UNIT_TYPE } from "@/api/types/control";
import { generationParams } from "./generateParams";
import { planInputs, sendSize } from "./inputPlan";

type ControlUnitWire = NonNullable<ControlRequest["control"]>[number];
type IpAdapterWire = NonNullable<ControlRequest["ip_adapter"]>[number];
type InputProcessWire = NonNullable<ControlRequest["input_process"]>[number];

export interface BuildResult {
  request: ControlRequest;
  /** The maps the job makes before generating, by key. */
  mapKeys: string[];
  /** The frames the request was built from, as read once at the start. */
  inputs: JobInputs;
  /** Where each upload the request names came from. */
  ledger: Ledger;
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
  /** The server's processors, which every map key names. */
  processors: ProcessorFacts;
}

/** The canvas holds inputs the loaded model cannot take as they are. */
export class InputRefusal extends Error {
  override name = "InputRefusal";
}

/** A slot whose map the cache holds, which goes out in its picture's place. */
function isCurrent(slot: MapSlot | null): slot is MapSlot {
  return slot?.state === "current";
}

/** The processor the server runs on a picture before the job, when the slot
 * has one and no current map. */
function processBefore(slot: MapSlot | null): InputProcessWire {
  if (!slot || slot.state === "current") return null;
  return { process: slot.processor.id, params: slot.params, key: slot.key };
}

/** The pictures that go out with a processor, aligned with `inputs`; absent
 * when none does. */
function inputProcess(sent: SentInput[]): InputProcessWire[] | undefined {
  const entries = sent.map((s) => processBefore(s.map));
  return entries.some((e) => e !== null) ? entries : undefined;
}

/** A Reference picture as it is, or its map. */
async function referenceRef(up: Uploader, input: SentInput): Promise<string> {
  if (isCurrent(input.map)) return (await up.map(input.map.key)).ref;
  return up.file(input.frameId, input.pictureId ?? "");
}

/** Several pictures as one condition set, in the order sent: Initial frames
 * drawn at the output size, references raw, a current map in its picture's
 * place. */
async function uploadConditionSet(
  up: Uploader,
  sent: SentInput[],
  target: Size,
): Promise<string[]> {
  const refs: string[] = [];
  for (const input of sent) {
    if (input.role === "reference") refs.push(await referenceRef(up, input));
    else if (isCurrent(input.map)) refs.push((await up.map(input.map.key)).ref);
    else refs.push((await up.composite(input.frameId, target)).ref);
  }
  return refs;
}

/** A Control frame as a control unit: its source frame's composition at the
 * generation size as the unit's own picture, or its current map; with a
 * processor and no map, the server makes the map before the job. */
async function controlUnit(
  up: Uploader,
  send: ControlSend,
  target: Size,
): Promise<ControlUnitWire> {
  const s = send.settings;
  const override = isCurrent(send.map)
    ? (await up.map(send.map.key)).ref
    : (await up.composite(send.sourceFrameId, target)).ref;
  const before = processBefore(send.map);
  return {
    process: before?.process ?? "None",
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
    ...(before ? { process_params: before.params, key: before.key } : {}),
  };
}

/** An IP-Adapter frame as an adapter unit: its pictures raw, in order, with
 * the region masks it holds. */
async function ipAdapterUnit(up: Uploader, send: IpAdapterSend): Promise<IpAdapterWire> {
  const images = await Promise.all(send.pictureIds.map((id) => up.file(send.frameId, id)));
  const masks = await Promise.all(send.settings.masks.map((m) => up.ipMask(send.frameId, m.id)));
  return {
    adapter: send.settings.adapter,
    scale: send.settings.scale,
    crop: send.settings.crop,
    start: send.settings.start,
    end: send.settings.end,
    images,
    ...(masks.length > 0 ? { masks } : {}),
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
  processors,
}: ControlBuildOptions): Promise<BuildResult> {
  const gen = useGenerationStore.getState();
  const scripts = useScriptStore.getState();
  const img2img = useImg2ImgStore.getState();
  const { frames, sizeSource } = useInputStore.getState();
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
  const unified = controlUnified === true;
  const base = computeOutline(frames, { controlUnified: unified });
  const unreadable = unreadableText(base.entries) ?? unreadableControlText(base);
  if (unreadable) throw new InputRefusal(unreadable);
  const problem = base.problems[0];
  if (problem) throw new InputRefusal(problemText(problem));
  const planned = planInputs({
    sent: base.sent,
    frame: { width: gen.width, height: gen.height },
    sizeMode: img2img.sizeMode,
    autoFit: ui.autoFitFrame,
    scaleFactor: img2img.scaleFactor,
    megapixelTarget: img2img.megapixelTarget,
    sizeMultiple,
    maxInputImages,
    requestSetsSize,
    referenceSets,
    sendsControlUnits: base.controls.length > 0 || base.ipAdapters.length > 0,
    sendsControlPictures: base.controls.length > 0,
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
  // Set members, a separate init and control pictures are drawn at the size the model generates at
  const target = sendSize(plan, frame, sizeMultiple);
  const { sent, controls, ipAdapters } = await outlineWithMaps(frames, processors, {
    cloud: false,
    controlUnified: unified,
    frame,
    target,
  });
  const up = createUploader({ frames, size: frame });

  if (ipAdapters.length > 0) {
    request.ip_adapter = await Promise.all(ipAdapters.map((send) => ipAdapterUnit(up, send)));
  }
  if (controls.length > 0) {
    request.control = await Promise.all(controls.map((send) => controlUnit(up, send, target)));
  }

  const primary: SentInput | undefined = sent[0];
  if (plan.transport === "set") {
    request.inputs = await uploadConditionSet(up, sent, target);
    request.skip_processing = true;
    request.input_type = 1;
    request.width_before = plan.target.width;
    request.height_before = plan.target.height;
    request.batch_count = plan.batchCount;
    request.batch_size = 1;
  } else if (plan.transport === "reference" && primary?.role === "reference") {
    // The source file as it is, or its map
    request.inputs = [await referenceRef(up, primary)];
    request.input_type = 1;
    request.width_before = plan.size.width;
    request.height_before = plan.size.height;
  } else if (plan.transport === "img2img" && primary?.role === "initial") {
    // img2img: add inputs, mask, inpainting params
    request.width_before = plan.target.width;
    request.height_before = plan.target.height;

    // The frame's pictures at frame size for the server to resize, or drawn
    // at the generation size when they travel beside control pictures; a
    // current map was made at that same size and goes in their place.
    const drawnAt = plan.separateInit ? target : frame;
    const init = isCurrent(primary.map)
      ? await up.map(primary.map.key)
      : await up.composite(primary.frameId, drawnAt);
    request.inputs = [init.ref];
    if (plan.separateInit) {
      // Control units bring their own pictures: the init travels separately (input_type 2),
      // drawn here because sdnext resizes a separate init with its global upscaler.
      // inputs repeats it so sdnext still sizes the unit pictures against it.
      request.inits = [init.ref];
      request.input_type = 2;
    } else {
      request.input_type = 1;
      // Force resize_mode_before=1 (Fixed) + resize_name_before so the backend
      // resizes the init image to the generation size.
      // Both fields are required: run.py zeros resize_mode when resize_name is 'None'.
      if (plan.serverResize) {
        request.resize_mode_before = 1;
        request.resize_name_before = img2img.resizeMethod;
      }
    }

    // The frame's mask objects + any strokes not baked yet
    const mask = await up.mask(primary.frameId, frame);
    if (mask) {
      request.mask = mask;
      request.mask_blur = img2img.maskBlur;
      request.inpaint_full_res = img2img.inpaintFullRes;
      request.inpaint_full_res_padding = img2img.inpaintFullResPadding;
      request.inpainting_mask_invert = img2img.inpaintingMaskInvert ? 1 : 0;
      request.mask_apply_overlay = img2img.maskApplyOverlay;
      request.inpainting_mask_weight = img2img.inpaintingMaskWeight;
    }
  }

  // The processors the server runs on the input images before the job
  if (request.inputs && request.inputs.length > 0) {
    const before = inputProcess(sent);
    if (before) request.input_process = before;
  }

  // User override settings (merged last to take priority)
  if (Object.keys(gen.overrideSettings).length > 0) {
    request.extra = {
      ...request.extra,
      ...gen.overrideSettings,
    };
  }

  const mapKeys = [
    ...sent.flatMap((s) => (processBefore(s.map) ? [s.map?.key ?? ""] : [])),
    ...controls.flatMap((c) => (processBefore(c.map) ? [c.map?.key ?? ""] : [])),
  ].filter(Boolean);
  return { request, mapKeys, inputs: { frames, size: frame, sizeSource }, ledger: up.ledger };
}
