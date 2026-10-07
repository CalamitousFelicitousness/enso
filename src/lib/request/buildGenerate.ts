// WYSIWYG request assembly - bridges the canvas UI state and the backend API.
//
// For img2img: visible canvas layers are flattened into a single image at frame
// resolution via flattenCanvas(), then uploaded as the init image. The backend
// receives exactly what the user sees inside the generation frame. Several
// input pictures go out as one condition set in the order the outline numbers
// them; Control and IP-Adapter frames go out as the outline lists them. A
// processed picture goes out as its map when the cache holds it, else with
// its processor and key for the server to make the map before generating.
// See flattenCanvas.ts and resize.ts for the compositing and resize pipeline.

import { useGenerationStore } from "@/stores/generationStore";
import { useScriptStore } from "@/stores/scriptStore";
import { useImg2ImgStore } from "@/stores/img2imgStore";
import { useInputStore } from "@/stores/inputStore";
import { useUiStore } from "@/stores/uiStore";
import { exportMask } from "@/lib/exportMask";
import { flattenCanvas } from "@/lib/flattenCanvas";
import { uploadBlob } from "@/lib/upload";
import { currentMap, lookupMaps, mapFacts, touchMap, useMapStore } from "@/inputs/maps";
import type { ProcessorFacts } from "@/lib/processorUtils";
import {
  computeOutline,
  type ControlSend,
  type IpAdapterSend,
  type MapSlot,
  type Outline,
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
import { planInputs, sendSize } from "./inputPlan";

type ControlUnitWire = NonNullable<ControlRequest["control"]>[number];
type IpAdapterWire = NonNullable<ControlRequest["ip_adapter"]>[number];
type InputProcessWire = NonNullable<ControlRequest["input_process"]>[number];

export interface BuildResult {
  request: ControlRequest;
  /** The maps the job makes before generating, by key. */
  mapKeys: string[];
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

/** The map a slot is sent as, when the cache holds it. Sending it keeps its
 * record from expiring. */
function sentMap(slot: MapSlot | null): Blob | null {
  const map = slot?.state === "current" ? currentMap(slot.key) : null;
  if (slot && map) touchMap(slot.key);
  return map?.blob ?? null;
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

/** The outline with its maps as the cache knows them, once the cache has
 * answered for every map it names, so a stored map is sent, not made again.
 * Its keys name the pictures as this request sends them: placed in `frame`,
 * drawn at `target` where they are resized before they go out. */
async function outlineWithMaps(
  frames: Frame[],
  controlUnified: boolean,
  processors: ProcessorFacts,
  frame: Size,
  target: Size,
): Promise<Outline> {
  const env = () => mapFacts(processors, useMapStore.getState(), false, frame, target);
  const named = computeOutline(frames, { controlUnified, processing: env() });
  await lookupMaps(named.entries.flatMap((e) => e.maps.map((m) => m.key)));
  return computeOutline(frames, { controlUnified, processing: env() });
}

/** Several pictures as one condition set, in the order sent: Initial frames
 * drawn at the output size here, references raw, a current map in its
 * picture's place. */
async function uploadConditionSet(
  sent: SentInput[],
  frames: Frame[],
  frame: Size,
  target: Size,
): Promise<string[]> {
  const refs: string[] = [];
  for (const input of sent) {
    const map = sentMap(input.map);
    if (map) {
      refs.push(await uploadBlob(map, "map.png"));
      continue;
    }
    if (input.role === "reference") {
      const picture = fileOf(frames, input);
      refs.push(await uploadBlob(picture.file, picture.name));
      continue;
    }
    const layers = composedPictures(frameOf(frames, input));
    const flat = await flattenCanvas(layers, frame.width, frame.height, target);
    if (!flat) throw new Error("Failed to flatten an input frame");
    refs.push(await uploadBlob(flat, "input.png"));
  }
  return refs;
}

/** A Control frame as a control unit: its source frame's composition at the
 * generation size as the unit's own picture, or its current map; with a
 * processor and no map, the server makes the map before the job. */
async function controlUnit(
  send: ControlSend,
  frames: Frame[],
  frame: Size,
  target: Size,
): Promise<ControlUnitWire> {
  const source = frames.find((f) => f.id === send.sourceFrameId);
  if (!source) throw new Error("A control frame's source is gone");
  const s = send.settings;
  const map = sentMap(send.map);
  let override: string;
  if (map) {
    override = await uploadBlob(map, "map.png");
  } else {
    const flat = await flattenCanvas(composedPictures(source), frame.width, frame.height, target);
    if (!flat) throw new Error("Failed to flatten a control frame");
    override = await uploadBlob(flat, "control.png");
  }
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
  processors,
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
  const { sent, controls, ipAdapters } = await outlineWithMaps(
    frames,
    unified,
    processors,
    frame,
    target,
  );

  if (ipAdapters.length > 0) {
    request.ip_adapter = await Promise.all(ipAdapters.map((send) => ipAdapterUnit(send, frames)));
  }
  if (controls.length > 0) {
    request.control = await Promise.all(
      controls.map((send) => controlUnit(send, frames, frame, target)),
    );
  }

  const primary: SentInput | undefined = sent[0];
  if (plan.transport === "set") {
    request.inputs = await uploadConditionSet(sent, frames, frame, target);
    request.skip_processing = true;
    request.input_type = 1;
    request.width_before = plan.target.width;
    request.height_before = plan.target.height;
    request.batch_count = plan.batchCount;
    request.batch_size = 1;
  } else if (plan.transport === "reference" && primary?.role === "reference") {
    // The source file as it is, or its map
    const map = sentMap(primary.map);
    const picture = fileOf(frames, primary);
    request.inputs = [
      map ? await uploadBlob(map, "map.png") : await uploadBlob(picture.file, picture.name),
    ];
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
    const source = frameOf(frames, primary);
    const drawnAt = plan.separateInit ? target : frame;
    const init =
      sentMap(primary.map) ??
      (await flattenCanvas(composedPictures(source), frame.width, frame.height, drawnAt));
    if (init) {
      const ref = await uploadBlob(init, "input.png");
      request.inputs = [ref];
      if (plan.separateInit) {
        // Control units bring their own pictures: the init travels separately (input_type 2),
        // drawn here because sdnext resizes a separate init with its global upscaler.
        // inputs repeats it so sdnext still sizes the unit pictures against it.
        request.inits = [ref];
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
  return { request, mapKeys };
}
