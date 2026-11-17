import { toast } from "sonner";
import { useVideoStore } from "@/stores/videoStore";
import { useVideoCanvasStore, type VideoSlotId } from "@/stores/videoCanvasStore";
import { useProcessStore } from "@/stores/processStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useUiStore } from "@/stores/uiStore";
import type { VideoSubTab } from "@/lib/constants";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import {
  addFilesToInputs,
  addingWait,
  addServerPictures,
  fetchAdmitted,
  placePictures,
  preparePictures,
  readyPictures,
} from "@/inputs/route";
import { announce, wait } from "@/undo/marks";
import { nameText } from "@/lib/undo/text";
import { galleryPicture, resultPicture, type ServerPicture } from "@/inputs/adopt";
import { mediaFile } from "@/lib/mediaFiles";
import { engineToKind } from "@/lib/videoModel";
import type { ImagePayload } from "@/lib/drag";
import type { Destination } from "@/lib/media/limits";
import type { LocalVideoModel } from "@/api/types/cloud";
import type { VideoWireParams } from "@/api/types/wireParams";
import { VIDEO_PARAMS, WIRE_TO_STORE, coerce, type VideoJobType } from "@/lib/video/paramRegistry";
import { repairCodecOptions } from "@/lib/videoOutputPresets";

export function extractFrameFromVideo(videoUrl: string, time: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.muted = true;

    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
    };

    video.addEventListener("error", () => {
      cleanup();
      reject(new Error("Failed to load video"));
    });

    video.addEventListener("loadedmetadata", () => {
      const clampedTime = Math.min(Math.max(0, time), video.duration);
      video.currentTime = clampedTime;
    });

    video.addEventListener(
      "seeked",
      () => {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanup();
          reject(new Error("Canvas 2D context unavailable"));
          return;
        }
        ctx.drawImage(video, 0, 0);
        canvas.toBlob((blob) => {
          cleanup();
          if (blob) resolve(blob);
          else reject(new Error("Failed to capture frame"));
        }, "image/png");
      },
      { once: true },
    );

    video.src = videoUrl;
  });
}

export function blobToFile(blob: Blob, filename = "frame.png"): File {
  return new File([blob], filename, { type: blob.type });
}

/** Switch to the Video view and land on the sub-tab that shows what was
 * just sent. The video prompt and input controls each live in their own tab,
 * so the view alone no longer puts them on screen. */
function showVideoTab(tab: VideoSubTab) {
  const ui = useUiStore.getState();
  ui.setNavView("video");
  ui.setPanelSelection("videoSubTab", tab);
}

/** An image into a Video slot, through the door; answers its id, or null for
 * a picture refused or unreadable, which is said. */
export async function placeVideoPicture(slot: VideoSlotId, file: File): Promise<string | null> {
  const [picture] = await preparePictures([file], "video");
  if (!picture) return null;
  const url = URL.createObjectURL(picture.file);
  const store = useVideoCanvasStore.getState();
  return slot === "references"
    ? store.addReference(picture.file, url, picture.width, picture.height, { kind: "image" })
    : store.setFrame(slot, picture.file, url, picture.width, picture.height);
}

/** Answers whether the frame entered the slot. */
export async function sendFrameToVideoInit(blob: Blob): Promise<boolean> {
  if (!(await placeVideoPicture("init", blobToFile(blob, "init-frame.png")))) return false;
  showVideoTab("inputs");
  return true;
}

/** Answers whether the frame entered the slot. */
export async function sendFrameToVideoLast(blob: Blob): Promise<boolean> {
  if (!(await placeVideoPicture("last", blobToFile(blob, "last-frame.png")))) return false;
  showVideoTab("inputs");
  return true;
}

/** Answers whether Process took the frame. */
export async function sendFrameToUpscale(blob: Blob): Promise<boolean> {
  if (!(await useProcessStore.getState().setImage(blobToFile(blob, "frame.png")))) return false;
  useUiStore.getState().setNavView("process");
  return true;
}

/** A file, or what reads it once the action's wait is open. */
export type FileSource = File | (() => Promise<File>);

const readSource = (source: FileSource) =>
  typeof source === "function" ? source() : Promise.resolve(source);

/** Answers whether the picture entered a frame. */
export async function sendImageToCanvas(source: FileSource): Promise<boolean> {
  const waited = addingWait(1, null);
  try {
    const file = await readSource(source);
    if (waited.cancelled) return false;
    const [added] = await addFilesToInputs([file], null, waited);
    if (!added) return false;
    useUiStore.getState().setNavView("images");
    return true;
  } finally {
    waited.end();
  }
}

/** Send a picture and the prompts that made it to the Images view as one
 * step: the picture is read first, then both land together. Answers whether
 * the picture entered a frame. */
export async function sendImageAndPrompt(
  source: FileSource,
  prompt: string,
  negative?: string,
): Promise<boolean> {
  const name = { kind: "image and prompt" } as const;
  const waited = wait("images", name);
  try {
    const file = await readSource(source);
    if (waited.cancelled) return false;
    const ready = await readyPictures([file], null);
    if (!ready) return false;
    let added = false;
    waited.land(() => {
      added = placePictures(ready).added > 0;
      if (!added) return;
      const gen = useGenerationStore.getState();
      if (prompt) gen.setParam("prompt", prompt);
      if (prompt && negative) gen.setParam("negativePrompt", negative);
      announce("images").show(nameText(name));
    });
    if (!added) return false;
    useUiStore.getState().setNavView("images");
    return true;
  } finally {
    waited.end();
  }
}

/** Send a picture the server holds to the canvas, which takes it into the
 * store once it has entered a frame. Answers whether it entered. */
export async function sendPictureToCanvas(picture: ServerPicture): Promise<boolean> {
  if (!(await addServerPictures([picture]))) return false;
  useUiStore.getState().setNavView("images");
  return true;
}

export function sendPromptToGeneration(prompt: string, negative?: string) {
  const gen = useGenerationStore.getState();
  gen.setParam("prompt", prompt);
  if (negative) gen.setParam("negativePrompt", negative);
  useUiStore.getState().setNavView("images");
}

export function sendPromptToVideo(prompt: string, negative?: string) {
  const store = useVideoStore.getState();
  store.setParam("prompt", prompt);
  if (negative) store.setParam("negative", negative);
  showVideoTab("prompts");
}

export function appendToGenerationPrompt(text: string) {
  const gen = useGenerationStore.getState();
  const current = gen.prompt;
  gen.setParam("prompt", current ? `${current} ${text}` : text);
}

export function restoreVideoSettings(params: VideoWireParams, domain: VideoJobType = "video") {
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

  const map = WIRE_TO_STORE[domain];
  const updates: Record<string, unknown> = {};
  for (const [wireKey, value] of Object.entries(params)) {
    const storeKey = map[wireKey];
    if (!storeKey) continue;
    const coerced = coerce(VIDEO_PARAMS[storeKey].kind, value);
    if (coerced !== undefined) updates[storeKey] = coerced;
  }
  if (typeof updates["codecOptions"] === "string") {
    updates["codecOptions"] = repairCodecOptions(updates["codecOptions"]);
  }

  if (Object.keys(updates).length > 0) {
    useVideoStore.getState().setParams(updates);
  }

  // Restore the engine/model selection too. The params echo identifies the
  // model by engine + model (generic), variant (FramePack), or model (LTX).
  // Synthesise a LocalVideoModel and set it as activeModel so the top-level
  // selector + Video panel both reflect the historical choice. mode/cached/
  // loaded aren't on the wire - they default to safe values and get
  // refreshed if the user re-picks the same model from the dropdown.
  let engineName: string | undefined;
  let modelName: string | undefined;
  if (domain === "framepack") {
    engineName = "FramePack";
    modelName = str(params.variant);
  } else if (domain === "ltx") {
    engineName = "LTX Video";
    modelName = str(params.model);
  } else {
    engineName = str(params.engine);
    modelName = str(params.model);
  }
  if (engineName && modelName) {
    const synthetic: LocalVideoModel = {
      source: "local-video",
      engine: engineName,
      model: modelName,
      name: modelName,
      title: `local-video:${engineName}:${modelName}`,
      mode: "t2v",
      workflow: null,
      cached: false,
      loaded: false,
      kind: engineToKind(engineName),
      caps: null,
      group_path: [],
    };
    useModelSelectionStore.getState().setActiveModel(synthetic);
  }
}

export async function sendResultToCanvas(
  result: { images: string[] },
  imageIndex: number,
): Promise<void> {
  await sendPictureToCanvas(resultPicture(result.images[imageIndex]));
}

export async function sendResultToUpscale(
  result: { images: string[] },
  imageIndex: number,
): Promise<void> {
  const [file] = await fetchAdmitted([resultPicture(result.images[imageIndex])], "process");
  if (file) await sendFrameToUpscale(file);
}

/** The picture a drag from a result or the gallery carries. Throws with the
 * reason when it can no longer be had. */
export function payloadToPicture(payload: ImagePayload): ServerPicture {
  switch (payload.type) {
    case "result-image": {
      const result = useGenerationStore.getState().results.find((r) => r.id === payload.resultId);
      const raw = result?.images[payload.imageIndex];
      if (!raw) throw new Error("That result is no longer on the strip");
      return resultPicture(raw);
    }
    case "gallery-image":
      return galleryPicture(payload.filePath);
  }
}

/** The picture a drag carries, as a file. Rejects with the reason when it can no longer be had. */
export async function payloadToFile(payload: ImagePayload): Promise<File> {
  const picture = payloadToPicture(payload);
  return mediaFile(picture.url, picture.name);
}

/** The picture a drag carries, its head admitted to `where` before the rest
 * is fetched; null when refused, which is said. Rejects with the reason when
 * it can no longer be had. */
export async function payloadToAdmitted(
  payload: ImagePayload,
  where: Destination,
): Promise<File | null> {
  const [file] = await fetchAdmitted([payloadToPicture(payload)], where);
  return file;
}

/** Say why a dropped picture could not be taken. */
export function dropFailed(err: unknown): void {
  console.error("[drop] the dropped picture could not be read", err);
  toast.error("The dropped picture could not be read", {
    description: err instanceof Error ? err.message : String(err),
  });
}
