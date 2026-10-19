// The words of recipes: saving, the model states, Restore and Run, export and import.

import { aboutSize } from "@/lib/media/text";
import type { ModelState } from "./models";
import type { LeftOut } from "./portable";

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export const RECIPE = "Recipe";
export const SAVE_RECIPE = "Save recipe";
export const SAVE_RECIPE_HINT = "Prompt, settings, model and input pictures, kept in the library";
export const EXPORT_ENTRY = "Export";
export const EXPORT_HINT = "Export as a file";
export const IMPORT_FILE = "Import a file";
export const FIND_ON_CIVITAI = "Find on CivitAI";
export const ALL_MODELS_FOUND = "Every model was found";
export const OPENS_RESTORE = "Opens Restore";
export const NO_LORA_IDENTITY = "This LoRA's file was not identified when the recipe was made";
export const NOT_ON_CIVITAI = "Not found on CivitAI, or CivitAI did not answer";
export const DOWNLOAD_QUEUED = "Queued";
export const OPEN_DOWNLOADS = "Open the download queue";
export const RESTORE_MODEL = "Model";
export const RECIPE_QUEUED = "Recipe queued";
export const RESTORE_RECIPE_TITLE = "Restore recipe";
export const RECIPE_COLUMN = "Recipe";
export const READING_RECIPE = "Reading the recipe";
export const RECIPE_ONLY_GENERATE = "Only an image generation can be saved as a recipe";

export function packingText(name: string): string {
  return `Packing "${name}"`;
}

export function exportedText(name: string, pictures: number, bytes: number): string {
  return `Exported "${name}" (${pictures === 0 ? "no pictures" : plural(pictures, "picture", "pictures")}, ${aboutSize(bytes)})`;
}

export function importingText(name: string, done: number, total: number): string {
  return `Importing "${name}", ${aboutSize(done)} of ${aboutSize(total).replace(/^about /, "")}`;
}

export function importedText(names: readonly string[]): string {
  return names.length === 1 ? `Imported "${names[0]}"` : `Imported ${names.length} recipes`;
}

export function alreadyImportedText(name: string): string {
  return `Already in the library as "${name}"`;
}

const STATE: Record<ModelState, [short: string, long: string]> = {
  installed: ["Installed", "Installed"],
  otherFile: ["Other file", "Another file with this name is installed"],
  unchecked: ["Not checked", "Installed by name; the file was not checked"],
  missing: ["Not found", "Not found on this server"],
};

export function modelStateText(state: ModelState): string {
  return STATE[state][0];
}

export function modelStateLongText(state: ModelState): string {
  return STATE[state][1];
}

export function networksMissingText(n: number): string {
  return n === 1 ? "1 LoRA was not found" : `${n} LoRAs were not found`;
}

/** A recipe card's model line: "Not found · Juggernaut XL v11", "Installed ·
 * 2 LoRAs not found"; an installed model gives way to the LoRAs it lacks. */
export function modelLineText(
  model: { name: string; state: ModelState } | null,
  missingNetworks: number,
): string {
  const networks =
    missingNetworks > 0 ? `${plural(missingNetworks, "LoRA", "LoRAs")} not found` : null;
  if (!model) return networks ?? "";
  const named = model.state === "installed" && networks ? null : model.name;
  return [modelStateText(model.state), named, networks].filter((part) => part !== null).join(" · ");
}

const LEFT_OUT: Record<LeftOut, string> = {
  grading_lut_file: "Color LUT (a file on the server)",
  extra: "Advanced overrides",
};

export function settingsLeftOutText(leftOut: readonly LeftOut[]): string {
  return `Left out of the recipe: ${leftOut.map((key) => LEFT_OUT[key]).join(", ")}`;
}

export function newerRecipeText(version: number, reads: number): string {
  return `This file was made by a newer version of Enso (recipe format ${version}; this one reads ${reads})`;
}

export function skippedSettingsText(n: number): string {
  return n === 1
    ? "1 setting this version does not know was skipped"
    : `${n} settings this version does not know were skipped`;
}

export function loadingForText(model: string, name: string): string {
  return `Loading ${model} for "${name}"`;
}

/** Run's note when the recipe's model is not the one it runs on. */
export function runsOnLoadedText(model: string, state: Exclude<ModelState, "installed">): string {
  const why = {
    otherFile: "is installed as another file",
    unchecked: "is installed by name but was not checked",
    missing: "was not found on this server",
  }[state];
  return `${model} ${why}; runs on the loaded model`;
}

export function modelPickedText(model: string): string {
  return `${model} picked (Load to use it)`;
}

export function pickedText(model: string): string {
  return `Settings restored; ${modelPickedText(model)}`;
}

export function notPickedText(model: string): string {
  return `${model} was not found on this server; the loaded model stays`;
}

/** A drop or paste that held nothing the surface takes, with what it takes. */
export function nothingUsedText(source: "drop" | "paste", kinds: string): string {
  return `Nothing in the ${source} could be used here (${kinds})`;
}
