// The words of a reset: the dialog, the Settings section, the gate, the notice
// after and the palette.

import type { ResetRow } from "./manifest";
import type { ResetNote } from "./record";

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** "a", "a and b", "a, b and c". */
function listed(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** What this browser keeps, counted for the rows that list it. */
export interface ProfileMeasure {
  inputs: number;
  pictures: number;
  removals: number;
  results: number;
  videoResults: number;
  videoInputs: number;
  videoReferences: number;
  presets: number;
  prompts: number;
  pinnedPrompts: number;
  heldEntries: number;
  heldRecords: number;
  liveJobs: number;
}

export const RESET_TITLE = "Reset Enso in this browser?";
export const RESET_DESCRIPTION =
  "What is checked is deleted from this browser. It cannot be brought back.";
export const RESET_LABEL = "Reset";
export const RESET_COMMAND = "Reset Enso in this browser";
export const RESET_OPEN = "Reset Enso in this browser...";
export const RESET_KEYWORDS = [
  "clear",
  "wipe",
  "delete",
  "forget",
  "start over",
  "first run",
  "factory",
  "cache",
  "site data",
  "storage",
  "sign out",
  "log out",
];

export const PANEL_TITLE = "This browser";
export const PANEL_INTRO =
  "What Enso keeps in this browser. The library, the Gallery, the job history and the settings on the server are not part of it.";

/** What the Settings search finds the section by, beside its title. */
export const PANEL_KEYWORDS = [
  "reset",
  "clear",
  "delete",
  "start over",
  "site data",
  "storage",
  "sign out",
  "log out",
];

export const COUNTING = "Counting...";
export const NOTHING_STORED = "Nothing stored";

export const ROW_NAMES: Readonly<Record<ResetRow, string>> = {
  work: "Inputs and results",
  parameters: "Prompts and settings",
  saved: "Presets and prompt history",
  interface: "Interface",
  connection: "Connection",
  legacy: "Not yet on the server",
};

const DONE_NAMES: Readonly<Record<ResetRow, string>> = {
  work: "inputs and results",
  parameters: "prompts and settings",
  saved: "presets and prompt history",
  interface: "interface",
  connection: "connection",
  legacy: "what was not yet on the server",
};

const PARAMETERS =
  "The prompt, and every Generation, Video, Process and Caption setting back to its default, with the Color LUT and the enhancement history. The server's settings are not changed.";
const INTERFACE =
  "Panels, tabs, theme, accent color, UI scale, canvas view, quick settings, behavior settings (live previews, scroll wheel, autocomplete) and Civitai filters.";
const CONNECTION =
  "The server address and sign-in; you will need the password again. Signing in to SD.Next itself is not affected.";

function sentence(parts: readonly string[]): string {
  return parts.length === 0 ? NOTHING_STORED : `${listed(parts)}.`;
}

/** The line under a row: what it holds now. */
export function rowDetail(row: ResetRow, m: ProfileMeasure | null): string {
  if (row === "parameters") return PARAMETERS;
  if (row === "interface") return INTERFACE;
  if (row === "connection") {
    if (!m || m.liveJobs === 0) return CONNECTION;
    const running =
      m.liveJobs === 1
        ? "1 job from this browser is still running; its results go to History, not the strip."
        : `${m.liveJobs} jobs from this browser are still running; their results go to History, not the strip.`;
    return `${CONNECTION} ${running}`;
  }
  if (!m) return COUNTING;
  if (row === "work") {
    const parts: string[] = [];
    if (m.inputs > 0)
      parts.push(
        plural(m.inputs, "input", "inputs") +
          (m.pictures > 0 ? ` with ${plural(m.pictures, "picture", "pictures")}` : ""),
      );
    if (m.removals > 0)
      parts.push(`${plural(m.removals, "removed input", "removed inputs")} in the trash`);
    if (m.results > 0) parts.push(`${plural(m.results, "result", "results")} on the Result Strip`);
    if (m.videoResults > 0)
      parts.push(`${plural(m.videoResults, "result", "results")} on the Video Result Strip`);
    if (m.videoInputs > 0) parts.push(plural(m.videoInputs, "video input", "video inputs"));
    if (m.videoReferences > 0)
      parts.push(plural(m.videoReferences, "video reference", "video references"));
    return sentence(parts);
  }
  if (row === "saved") {
    const parts: string[] = [];
    if (m.presets > 0) parts.push(`${plural(m.presets, "preset", "presets")} you made`);
    if (m.prompts > 0)
      parts.push(
        `${plural(m.prompts, "prompt", "prompts")} in the prompt history` +
          (m.pinnedPrompts > 0 ? ", pinned ones too" : ""),
      );
    return sentence(parts);
  }
  const held: string[] = [];
  if (m.heldEntries > 0) held.push(plural(m.heldEntries, "saved entry", "saved entries"));
  if (m.heldRecords > 0) held.push(plural(m.heldRecords, "job record", "job records"));
  if (held.length === 0) return NOTHING_STORED;
  return `${listed(held)} kept in this browser by an older version, not moved to the server. Move them from the Library first to keep them.`;
}

export const STAYS =
  "Saved entries on the server, the Gallery, the server's job history and the server's settings stay.";
export const FETCHED_AGAIN = "Thumbnails and autocomplete lists are fetched again.";

export function otherTabsText(n: number): string {
  return n === 1
    ? "Enso is open in 1 other tab. Close it to continue."
    : `Enso is open in ${n} other tabs. Close them to continue.`;
}

export const TABS_WILL_RELOAD = "Other Enso tabs in this browser will reload.";
export const MOVING = "Wait for the move to the server to finish, or cancel it.";
export const CHOOSE_ROWS = "Choose what to reset.";
export const REQUEST_REFUSED = "The browser refused to store the request. Nothing was reset.";

const ACTION_WAITS: Readonly<Record<string, string>> = {
  images: "Wait for Generate to finish sending.",
  video: "Wait for the video to finish sending.",
  process: "Wait for Process to finish sending.",
  caption: "Wait for the caption to finish.",
  interrogate: "Wait for the interrogation to finish.",
  "png-info": "Wait for PNG info to finish reading.",
  recipe: "Wait for the recipe to finish saving.",
};

/** Why a reset waits for a running action, by its id. */
export function actionRunningText(action: string): string {
  if (action.startsWith("enhance:")) return "Wait for the prompt enhancement to finish.";
  return ACTION_WAITS[action] ?? "Wait for the upload to finish.";
}

export const RESETTING_LINE = "Resetting Enso in this browser...";

export const RESET_DONE = "Enso reset in this browser";
export const POSTPONED = "Reset postponed";
export const POSTPONED_TEXT = "Enso opened in another tab. Close it and try again.";

export const NOTE_TEXT: Readonly<Record<ResetNote, string>> = {
  session: "The server could not be reached to end the sign-in.",
  blocked: "Some of it may not have been cleared; close every Enso tab, then reset again.",
  newer: "Inputs a newer version of Enso saved were left as they were.",
};

/** The notice's description: what was cleared, then what did not go as asked. */
export function doneText(rows: readonly ResetRow[], notes: readonly ResetNote[]): string {
  const cleared = `Cleared: ${rows.map((row) => DONE_NAMES[row]).join("; ")}.`;
  return [cleared, ...notes.map((note) => NOTE_TEXT[note])].join(" ");
}

export const FROZEN_TITLE = "Enso is being reset in another tab";
export const FROZEN_TEXT = "This tab reloads when it is done; changes made here are not kept.";
export const RELOAD = "Reload";

export const HELP = "Help";
export const SHOW_TUTORIAL = "Show the tutorial";
export const KEYBOARD_SHORTCUTS = "Keyboard shortcuts";
