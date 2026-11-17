// The undo history's words: what each step is called, where it was made,
// and what the Top Bar and the notices say about it.

import { filesMovedToTrashText, filesRestoredText } from "@/lib/gallery/text";
import { entryTrashedText, positionLabel, untrashedText } from "@/lib/inputs/text";
import { JOB_DELETED, restoredText, stripTrimmedText, type RestoreKind } from "@/lib/jobs/text";
import { settingLabel } from "@/lib/settingLabels";
import type { NavView } from "@/lib/constants";
import type { Patch, Step, StepName, Values } from "./types";

/** A step as its words need it. */
export type Named = Pick<Step, "scope" | "name" | "patches" | "riders">;

type Args = NonNullable<StepName["args"]>;

const text = (args: Args, key: string): string => {
  const value = args[key];
  return value === undefined ? "" : String(value);
};

const count = (args: Args, key: string): number => {
  const value = args[key];
  return typeof value === "number" ? value : 0;
};

/** "Input 2", or "An input" when the step did not say which. */
function input(args: Args): string {
  const position = count(args, "position");
  return position > 0 ? positionLabel(position) : "An input";
}

/** The labels of the recorded keys outside the generation settings. */
const KEY_LABELS: Readonly<Record<string, string>> = {
  "img2img.resizeMode": "Resize mode",
  "img2img.sizeMode": "Size mode",
  "img2img.scaleFactor": "Scale",
  "img2img.megapixelTarget": "Megapixels",
  "img2img.resizeMethod": "Resize method",
  "img2img.autoSize": "Auto size",
  "img2img.maskBlur": "Mask blur",
  "img2img.inpaintFullRes": "Inpaint masked area only",
  "img2img.inpaintFullResPadding": "Mask padding",
  "img2img.inpaintingMaskInvert": "Invert mask",
  "img2img.maskApplyOverlay": "Mask overlay",
  "fit.autoFitFrame": "Fit",
  "scripts.selectedScript": "Script",
  "scripts.scriptArgs": "Script settings",
  "scripts.alwaysOnOverrides": "Script settings",
  "scripts.alwaysOnEnabled": "Scripts on",
  "lut.images": "Color LUT file",
  "presets.presets": "Presets",
  "model.activeModel": "Model",
  "inputs.sizeSource": "Size from",
};

/** The label of a recorded key, as the slice that holds it names it. */
export function keyLabel(slice: string, key: string): string {
  if (slice === "settings") return settingLabel(key);
  return KEY_LABELS[`${slice}.${key}`] ?? key;
}

/** The last segment of a model's path: what the Model Selector shows. */
function modelText(value: unknown): string {
  if (typeof value !== "object" || value === null) return "none";
  const model = value as Record<string, unknown>;
  const name = [model["model_name"], model["model"], model["title"], model["id"]].find(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  return name ? (name.split("/").pop() ?? name) : "a model";
}

/** Longer than this, a value is not quoted in a step's name. */
const QUOTED_MAX = 32;

/** A value as a step's name shows it; null when it is not worth showing. */
export function valueText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return "none";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number")
    return Number.isInteger(value) ? String(value) : String(+value.toFixed(4));
  if (typeof value === "string") {
    return value.length <= QUOTED_MAX && !value.includes("\n") ? value : null;
  }
  return null;
}

interface KeyChange {
  readonly slice: string;
  readonly key: string;
  readonly before: unknown;
  readonly after: unknown;
}

/** Every key a step's patches changed, riders included. */
function keyChanges(step: Named): KeyChange[] {
  const changes: KeyChange[] = [];
  const add = (slice: string, before: Values, after: Values) => {
    for (const key of Object.keys(before)) {
      changes.push({ slice, key, before: before[key], after: after[key] });
    }
  };
  for (const patch of [...step.patches, ...step.riders]) {
    if (patch.kind === "keys") add(patch.slice, patch.before, patch.after);
    else add(patch.slice, patch.keys.before, patch.keys.after);
  }
  return changes;
}

/** A changed object's one changed field, for "Detailer: Strength 0.4 to 0.6". */
function fieldChange(before: unknown, after: unknown): KeyChange | null {
  if (typeof before !== "object" || typeof after !== "object" || !before || !after) return null;
  if (Array.isArray(before) || Array.isArray(after)) return null;
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]),
  );
  return keys.length === 1
    ? { slice: "", key: keys[0], before: a[keys[0]], after: b[keys[0]] }
    : null;
}

function changeText(change: KeyChange): string {
  if (change.slice === "model") return `Model ${modelText(change.after)} picked`;
  const label = keyLabel(change.slice, change.key);
  const field = fieldChange(change.before, change.after);
  if (field) {
    const from = valueText(field.before);
    const to = valueText(field.after);
    return from !== null && to !== null
      ? `${label}: ${field.key} ${from} to ${to}`
      : `${label} settings`;
  }
  const from = valueText(change.before);
  const to = valueText(change.after);
  return from !== null && to !== null ? `${label} ${from} to ${to}` : `${label} changed`;
}

/** Words for a step named by what changed: one key by its label and values,
 * a model pick by the model, else a count. */
function changedText(step: Named): string {
  const changes = keyChanges(step);
  const model = changes.find((c) => c.slice === "model");
  if (changes.length === 1) return changeText(changes[0]);
  if (model) return changeText(model);
  if (changes.length > 1) return `${changes.length} settings`;
  return step.patches.some((p) => p.kind === "list") ? "Inputs changed" : "Change";
}

const RESTORE_KINDS: ReadonlySet<string> = new Set<RestoreKind>(["settings", "inputs", "both"]);

/** What each named kind of step is called. */
const WORDS: Readonly<Record<string, (args: Args, step: Named) => string>> = {
  // inputs, named by the edit that made them
  "frame added": (a) => `${input(a)} added`,
  "frame removed": (a) => `${input(a)} removed`,
  "frame moved": (a) => `${input(a)} moved`,
  role: (a) => `${input(a)}: role changed`,
  on: (a, step) => `${input(a)} ${frameAfter(step, a)?.["enabled"] === false ? "off" : "on"}`,
  cleared: (a) => `${input(a)} cleared`,
  "picture added": (a) => `Picture added to ${input(a)}`,
  "picture removed": (a) => `Picture removed from ${input(a)}`,
  "picture moved": (a) => `Picture moved in ${input(a)}`,
  "picture changed": (a) => `Picture changed in ${input(a)}`,
  placement: (a) => `Picture moved in ${input(a)}`,
  visibility: (a) => `Picture shown or hidden in ${input(a)}`,
  "put back": (a) => `Put back into ${input(a)}`,
  merged: (a) => `${input(a)} merged`,
  "problem fixed": (a) => `Problem fixed in ${input(a)}`,
  fit: (a) => `${input(a)}: fit changed`,
  link: (a) => `${input(a)}: link changed`,
  control: (a) => `${input(a)}: control settings`,
  "ip adapter": (a) => `${input(a)}: IP-Adapter settings`,
  processor: (a) => `${input(a)}: processor changed`,
  replaced: (a) => `Pictures replaced in ${input(a)}`,
  stroke: (a) => `Brush stroke on ${input(a)}`,
  "strokes cleared": (a) => `Strokes cleared on ${input(a)}`,
  "mask cleared": (a) => `Mask cleared on ${input(a)}`,
  "mask region removed": (a) => `Mask region removed from ${input(a)}`,
  "mask region changed": (a) => `Mask region changed on ${input(a)}`,
  restored: () => "Inputs restored",
  appended: () => "Inputs added",
  "size source": () => "Size from changed",
  // named by what changed
  set: (_a, step) => changedText(step),
  edit: (_a, step) => changedText(step),
  command: () => "Change",
  // actions that name their own step
  "model defaults": (a) => `Defaults for ${text(a, "model")}`,
  preset: (a) => `Preset "${text(a, "name")}" loaded`,
  applied: (a) =>
    a["key"] !== undefined
      ? `${settingLabel(text(a, "key"))} applied`
      : `Settings applied from ${text(a, "from")}`,
  restore: (a) => {
    const what = text(a, "what");
    return RESTORE_KINDS.has(what) ? restoredText(what as RestoreKind) : "Restored";
  },
  recall: (a) =>
    text(a, "mode") === "replace"
      ? `Inputs replaced with "${text(a, "name")}"`
      : `"${text(a, "name")}" added`,
  "add pictures": (a) => {
    const n = count(a, "count");
    const what = n === 1 ? "Picture" : `${n} pictures`;
    // a frame not yet known while the inputs load
    return count(a, "position") > 0 ? `${what} added to ${input(a)}` : `${what} added`;
  },
  "ip mask": (a) => `IP-Adapter mask added to ${input(a)}`,
  "replace with maps": (a) => `${input(a)}: pictures replaced with their map`,
  "replace picture": (a) => `${input(a)}: picture replaced`,
  "from trash": () => "Restored from the trash",
  "oversized removed": () => "Oversized pictures removed",
  "image and prompt": () => "Image and prompt sent",
  enhance: () => "Prompt enhanced",
  "extend video": () => "Model for Extend video",
  "entry trashed": (a) => entryTrashedText(text(a, "name")),
  "entry restored": (a) => untrashedText(text(a, "name")),
  "files trashed": (a) => filesMovedToTrashText(count(a, "count"), text(a, "name")),
  "files restored": (a) => filesRestoredText(count(a, "count"), text(a, "name")),
  "delete job": () => JOB_DELETED,
  "strip trimmed": (a) => stripTrimmedText(count(a, "count")).title,
};

/** The frame a step's inputs patch left, by the frame its name names. */
function frameAfter(step: Named, args: Args): Record<string, unknown> | null {
  const id = text(args, "frame");
  for (const patch of step.patches) {
    if (patch.kind !== "list") continue;
    const after = patch.items[id]?.after;
    if (typeof after === "object" && after !== null) return after as Record<string, unknown>;
  }
  return null;
}

/** What a step is called. */
export function stepText(step: Named): string {
  const word = WORDS[step.name.kind];
  return word ? word(step.name.args ?? {}, step) : changedText(step);
}

/** What a name reads as without its patches: a wait's outcome, or the
 * notice of an action that names its own step. */
export function nameText(name: StepName): string {
  return stepText({ scope: "shared", name, patches: [], riders: [] });
}

export type Place =
  | "Images"
  | "Video"
  | "Process"
  | "Caption"
  | "Gallery"
  | "Library"
  | "History"
  | "Settings"
  | "Top Bar";

const VIEW_PLACES: Readonly<Record<NavView, Place>> = {
  images: "Images",
  video: "Video",
  process: "Process",
  caption: "Caption",
  gallery: "Gallery",
};

/** Shared steps by the place their action is taken in. */
const SHARED_PLACES: Readonly<Record<string, Place>> = {
  "entry trashed": "Library",
  "entry restored": "Library",
  "delete job": "History",
  "strip trimmed": "Settings",
};

/** Where a step's action was taken. */
export function placeOf(step: Pick<Step, "scope" | "name">): Place {
  if (step.scope !== "shared") return VIEW_PLACES[step.scope];
  return SHARED_PLACES[step.name.kind] ?? "Top Bar";
}

/** A step's words for a view: with its place when it is outside the view's own stack. */
function placed(step: Named, view: NavView): { words: string; place: Place | null } {
  const own = step.scope === view;
  return { words: stepText(step), place: own ? null : placeOf(step) };
}

const keys = (shortcut: string | null) => (shortcut ? ` (${shortcut})` : "");

/** The Top Bar Undo's tooltip. */
export function undoTitle(step: Named, view: NavView, shortcut: string | null): string {
  const { words, place } = placed(step, view);
  return `Undo${place ? ` in ${place}` : ""}: ${words}${keys(shortcut)}`;
}

/** The Top Bar Redo's tooltip. */
export function redoTitle(step: Named, view: NavView, shortcut: string | null): string {
  const { words, place } = placed(step, view);
  return `Redo${place ? ` in ${place}` : ""}: ${words}${keys(shortcut)}`;
}

/** The Top Bar Undo's tooltip while a wait is the newest thing in reach. */
export function cancelTitle(name: StepName, shortcut: string | null): string {
  return `Cancel: ${nameText(name)}${keys(shortcut)}`;
}

export const NOTHING_TO_UNDO = "Nothing to undo here";
export const NOTHING_TO_REDO = "Nothing to redo here";

/** "Undone: Brush stroke on Input 1", "Undone in Library: ...". */
export function undoneText(step: Named, view: NavView): string {
  const { words, place } = placed(step, view);
  return `Undone${place ? ` in ${place}` : ""}: ${words}`;
}

/** "Redone: Brush stroke on Input 1", "Redone in Library: ...". */
export function redoneText(step: Named, view: NavView): string {
  const { words, place } = placed(step, view);
  return `Redone${place ? ` in ${place}` : ""}: ${words}`;
}

export function cancelledText(name: StepName): string {
  return `Cancelled: ${nameText(name)}`;
}

/** A press its step's server request refused. */
export function refusedText(step: Named, kind: "undo" | "redo"): string {
  return `Could not ${kind} ${lowerFirst(stepText(step))}`;
}

/** What a failed server request left: the step with patches stays undone or redone. */
export function failedText(step: Named, kind: "undo" | "redo", dropped: boolean): string {
  const what = `${kind === "undo" ? "Undone" : "Redone"} here, but the server did not take it back`;
  return dropped ? refusedText(step, kind) : `${what}: ${stepText(step)}`;
}

export const MODEL_LEFT = "The model pick was left as it is";

export const HISTORY_RESTARTED =
  "The undo history started over. Your inputs and settings were kept.";

/** "This also clears 3 undo steps.", a sentence of the Empty dialog; null for none. */
export function clearsStepsText(n: number): string | null {
  if (n === 0) return null;
  return n === 1 ? "This also clears 1 undo step." : `This also clears ${n} undo steps.`;
}

/** "2 undo steps cleared", for the notice after a deletion; null for none. */
export function stepsClearedText(n: number): string | null {
  if (n === 0) return null;
  return n === 1 ? "1 undo step cleared" : `${n} undo steps cleared`;
}

function lowerFirst(words: string): string {
  // "Input 2 removed" keeps its capital: a name, not a sentence start
  return /^(Input|IP|LUT|CLIP|VAE)\b/.test(words) || /^"/.test(words)
    ? words
    : words.charAt(0).toLowerCase() + words.slice(1);
}

/** A key change a patch carries, for the Show button of a one-setting step. */
export function oneSetting(step: Named): { slice: string; key: string } | null {
  const changes = keyChanges(step);
  return changes.length === 1 && step.patches.every((p: Patch) => p.kind === "keys")
    ? { slice: changes[0].slice, key: changes[0].key }
    : null;
}

export const UNDO_TOUR_TITLE = "Undo and Redo";

/** The tutorial's words for the Top Bar's Undo and Redo, with their keys. */
export function undoTourText(undoKeys: string | null, redoKeys: string | null): string {
  const keys = undoKeys && redoKeys ? `; ${undoKeys} and ${redoKeys} do the same` : "";
  return `Take back the last change in the view you are on, or bring it back. Hover a button to see which change it is${keys}.`;
}
