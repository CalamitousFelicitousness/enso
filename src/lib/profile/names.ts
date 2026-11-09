// The names of everything Enso keeps in this browser. Stores and openers take
// their names from here, so the manifest knows every one of them; the origin
// is shared with SD.Next's own UI, and what is not named here is not Enso's.

/** localStorage keys. */
export const LOCAL = {
  connections: "enso-connections",
  ui: "enso-ui",
  tutorial: "enso-tutorial",
  generation: "enso-generation",
  video: "enso-video",
  img2img: "enso-img2img",
  process: "enso-process",
  processLut: "enso-process-lut",
  captionSettings: "enso-caption-settings",
  enhance: "enso-enhance",
  cloudText: "enso-cloud-text",
  modelSelection: "enso-model-selection",
  generationPresets: "enso-generation-presets",
  videoPresets: "enso-video-presets",
  promptHistory: "enso-prompt-history",
  modelCapabilities: "enso-model-capabilities",
  modelDownloads: "enso-model-downloads",
  videoHashes: "enso-video-hashes",
  client: "enso-client",
  sessionMode: "enso-session-mode",
  gallerySort: "enso-gallery-sort",
  galleryPictureOnly: "enso-gallery-picture-only",
} as const;

export type LocalKey = (typeof LOCAL)[keyof typeof LOCAL];

/** What every localStorage key of Enso starts with. */
export const LOCAL_PREFIX = "enso-";

/** IndexedDB databases. The two history databases and the thumbnail cache
 * keep the names of the build that created them. */
export const DB = {
  inputs: "enso-inputs",
  canvas: "enso-canvas",
  control: "enso-control",
  videoCanvas: "enso-video-canvas",
  colorLut: "enso-color-lut",
  history: "SDNextHistory",
  videoHistory: "SDNextVideoHistory",
  thumbs: "SDNextReact",
  dicts: "enso-dict-cache",
} as const;

export type DbName = (typeof DB)[keyof typeof DB];

/** The one object store of the databases that keep a record per key. */
export const STATE_STORE = "state";

/** Records by key: in the `state` store of their database, but `working`,
 * which is in the documents store of `enso-inputs`. */
export const RECORD = {
  canvas: "enso-canvas-v5",
  canvasV4: "enso-canvas-v4",
  canvasV3: "enso-canvas",
  control: "units",
  videoCanvas: "enso-video-canvas-v1",
  videoCanvasV0: "enso-video-canvas",
  colorLut: "enso-color-lut",
  working: "working",
} as const;
