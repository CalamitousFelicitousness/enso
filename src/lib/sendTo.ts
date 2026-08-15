import { useVideoStore } from "@/stores/videoStore";
import { useVideoCanvasStore } from "@/stores/videoCanvasStore";
import { useProcessStore } from "@/stores/processStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { useUiStore } from "@/stores/uiStore";
import { useModelSelectionStore } from "@/stores/modelSelectionStore";
import { fileToBase64, base64ToFile } from "@/lib/image";
import { resolveImageSrc } from "@/lib/utils";
import { engineToKind } from "@/lib/videoModel";
import type { DragPayload } from "@/stores/dragStore";
import type { LocalVideoModel } from "@/api/types/cloud";
import type { VideoWireParams } from "@/api/types/wireParams";
import { VIDEO_PARAMS, WIRE_TO_STORE, coerce, type VideoJobType } from "@/lib/video/paramRegistry";

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

export async function sendFrameToVideoInit(blob: Blob) {
  const file = blobToFile(blob, "init-frame.png");
  const base64 = await fileToBase64(file);
  const objectUrl = URL.createObjectURL(file);
  const img = new window.Image();
  img.src = objectUrl;
  await new Promise<void>((r) => {
    img.onload = () => r();
  });
  useVideoCanvasStore
    .getState()
    .setFrame("init", file, base64, objectUrl, img.naturalWidth, img.naturalHeight);
  useUiStore.getState().setNavView("video");
}

export async function sendFrameToVideoLast(blob: Blob) {
  const file = blobToFile(blob, "last-frame.png");
  const base64 = await fileToBase64(file);
  const objectUrl = URL.createObjectURL(file);
  const img = new window.Image();
  img.src = objectUrl;
  await new Promise<void>((r) => {
    img.onload = () => r();
  });
  useVideoCanvasStore
    .getState()
    .setFrame("last", file, base64, objectUrl, img.naturalWidth, img.naturalHeight);
  useUiStore.getState().setNavView("video");
}

export function sendFrameToUpscale(blob: Blob) {
  useProcessStore.getState().setImage(blobToFile(blob, "frame.png"));
  useUiStore.getState().setNavView("process");
}

export async function fetchRemoteImage(url: string, filename = "image.png"): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const blob = await res.blob();
  return blobToFile(blob, filename);
}

export async function sendImageToCanvas(file: File) {
  const base64 = await fileToBase64(file);
  const objectUrl = URL.createObjectURL(file);
  const img = new window.Image();
  img.src = objectUrl;
  await new Promise<void>((r) => {
    img.onload = () => r();
  });
  const state = useCanvasStore.getState();
  const target = state.activeInputFrameId ?? state.inputFrames[0]?.id;
  if (target) {
    state.addImageLayerToFrame(
      target,
      file,
      base64,
      objectUrl,
      img.naturalWidth,
      img.naturalHeight,
    );
  }
  useUiStore.getState().setNavView("images");
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
  useUiStore.getState().setNavView("video");
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
    };
    useModelSelectionStore.getState().setActiveModel(synthetic);
  }
}

export async function sendResultToCanvas(
  result: { images: string[] },
  imageIndex: number,
): Promise<void> {
  const raw = result.images[imageIndex];
  const src = resolveImageSrc(raw);
  const file = await fetchRemoteImage(src, "result.png");
  await sendImageToCanvas(file);
}

export async function sendResultToUpscale(
  result: { images: string[] },
  imageIndex: number,
): Promise<void> {
  const raw = result.images[imageIndex];
  const src = resolveImageSrc(raw);
  const res = await fetch(src);
  const blob = await res.blob();
  sendFrameToUpscale(blob);
}

export async function payloadToFile(payload: DragPayload): Promise<File> {
  if (payload.type === "result-image" && payload.resultId != null && payload.imageIndex != null) {
    const result = useGenerationStore.getState().results.find((r) => r.id === payload.resultId);
    if (result) {
      const raw = result.images[payload.imageIndex];
      if (raw) {
        const src = resolveImageSrc(raw);
        if (
          src.startsWith("data:") ||
          src.startsWith("blob:") ||
          src.startsWith("/") ||
          src.startsWith("http")
        ) {
          return fetchRemoteImage(src, "result.png");
        }
        // Raw base64 (no data: prefix)
        return base64ToFile(raw, "result.png");
      }
    }
  }

  if (payload.type === "gallery-image" && payload.filePath) {
    return fetchRemoteImage(
      `/file=${payload.filePath}`,
      payload.filePath.split("/").pop() ?? "gallery.png",
    );
  }

  throw new Error("Cannot resolve drag payload to file");
}
