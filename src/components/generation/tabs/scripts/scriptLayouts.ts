/** A layout resolved to the positions of the script's settings in the server's list. */
export interface ArgGroup {
  title: string | undefined;
  args: number[];
  grid: boolean | undefined;
  disabledUnless: number | undefined;
  argDisabledUnless: Record<number, number>; // Per-arg disable: arg index → controller arg index (truthiness check)
  argRequires: Record<number, { arg: number; includes: string }>; // Per-arg disable: arg disabled unless another arg's value includes a substring
}

export interface ScriptLayout {
  headerRow: number[]; // Arg indices rendered as switches in a top row
  enabledBy: number | undefined; // Header arg that turns the script on; the rest is disabled while it is off
  headerArgRequires: Record<number, { arg: number; includes: string }>; // Header arg disabled unless another arg's value includes a substring
  groups: ArgGroup[];
}

interface Requirement {
  arg: string;
  includes: string;
}

/** The same layout naming settings by label, which survives sdnext inserting a setting. */
interface LabelGroup {
  title?: string;
  args: string[];
  grid?: boolean;
  disabledUnless?: string;
  argDisabledUnless?: Record<string, string>;
  argRequires?: Record<string, Requirement>;
}

interface LabelLayout {
  headerRow?: string[];
  enabledBy?: string;
  headerArgRequires?: Record<string, Requirement>;
  groups: LabelGroup[];
}

/**
 * Per-script layout descriptors.
 * Keys are lowercase script names (matching ScriptInfoV2.name). Labels the script does not
 * have are skipped, and settings the server marks fixed are never shown. Unknown scripts
 * fall back to the flat arg list.
 */
const LAYOUTS: Record<string, LabelLayout> = {
  nudenet: {
    groups: [
      { args: ["NudeNet enabled"] },
      {
        title: "Detection",
        args: ["Sensitivity", "Block size"],
        disabledUnless: "NudeNet enabled",
      },
      {
        title: "Censoring",
        args: ["Censor", "Method", "Overlay", "Save copy"],
        disabledUnless: "NudeNet enabled",
      },
      {
        title: "Policy",
        args: [
          "Update metadata",
          "Check language",
          "Check policy violations",
          "Check banned words",
          "Allowed languages",
          "Allowed alphabets",
          "Banned words",
        ],
        grid: true,
        disabledUnless: "NudeNet enabled",
      },
    ],
  },

  "nvidia dlss": {
    groups: [
      { args: ["DLSS Operations"] },
      {
        title: "NeuralRender",
        args: [
          "NR profile",
          "NR motion vector",
          "NR scale",
          "NR intensity",
          "NR blend",
          "NR detail",
          "NR colour",
          "NR radius",
          "NR scene threshold",
          "NR normalized style",
          "NR local tone",
          "NR local structure",
          "NR skin structure",
          "NR mask structure",
        ],
      },
      {
        title: "SuperRes",
        args: [
          "SS profile",
          "SS scale",
          "SS detail strength",
          "SS colour strength",
          "SS detail radius",
          "SS scene threshold",
        ],
      },
      {
        title: "Advanced",
        args: ["DLSS full precision", "DLSS use CUDA graph", "DLSS chunk size"],
        grid: true,
      },
    ],
  },

  "prompt enhance": {
    headerRow: ["Auto enhance", "Use vision"],
    enabledBy: "Auto enhance",
    headerArgRequires: { "Use vision": { arg: "LLM model", includes: "\uf06e" } }, // the model's vision symbol
    groups: [
      { args: ["LLM model", "Prompt style"] },
      { title: "Prompts", args: ["System prompt", "Prompt prefix", "Prompt suffix"] },
      {
        title: "Options",
        args: [
          "Thinking mode",
          "Keep Thinking Trace",
          "NSFW allowed",
          "Keep Prefill",
          "Prefill text",
        ],
        grid: true,
        argDisabledUnless: {
          "Keep Prefill": "Prefill text",
          "Keep Thinking Trace": "Thinking mode",
        },
        argRequires: { "Thinking mode": { arg: "LLM model", includes: "\uf0eb" } }, // the model's reasoning symbol
      },
      {
        title: "Sampling",
        args: [
          "Use samplers",
          "Min tokens",
          "Max tokens",
          "Temperature",
          "Repetition penalty",
          "Top-K",
          "Top-P",
        ],
        disabledUnless: "Use samplers",
      },
    ],
  },
};

/** A script's layout over the labels the server lists for it; undefined for a script without one. */
export function resolveLayout(name: string, labels: readonly string[]): ScriptLayout | undefined {
  const layout = LAYOUTS[name];
  if (!layout) return undefined;
  const at = (label: string | undefined) => {
    const i = label === undefined ? -1 : labels.indexOf(label);
    return i < 0 ? undefined : i;
  };
  const list = (names: readonly string[] | undefined) =>
    (names ?? []).flatMap((label) => {
      const i = at(label);
      return i === undefined ? [] : [i];
    });
  const keyed = <T, U>(record: Record<string, T> | undefined, map: (value: T) => U | undefined) => {
    const out: Record<number, U> = {};
    for (const [label, value] of Object.entries(record ?? {})) {
      const i = at(label);
      const mapped = map(value);
      if (i !== undefined && mapped !== undefined) out[i] = mapped;
    }
    return out;
  };
  const requirement = (r: Requirement) => {
    const arg = at(r.arg);
    return arg === undefined ? undefined : { arg, includes: r.includes };
  };
  return {
    headerRow: list(layout.headerRow),
    enabledBy: at(layout.enabledBy),
    headerArgRequires: keyed(layout.headerArgRequires, requirement),
    groups: layout.groups.map((group) => ({
      title: group.title,
      args: list(group.args),
      grid: group.grid,
      disabledUnless: at(group.disabledUnless),
      argDisabledUnless: keyed(group.argDisabledUnless, at),
      argRequires: keyed(group.argRequires, requirement),
    })),
  };
}
