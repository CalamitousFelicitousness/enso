import { describe, expect, it } from "vitest";
import {
  NewerRecipe,
  readRecipe,
  readRecipeHead,
  readSettings,
  RECIPE_SCHEMA,
  UnreadableRecipe,
} from "./recipe";

const A = "a".repeat(64);
const B = "b".repeat(64);

function part(overrides: Record<string, unknown> = {}) {
  return {
    recipe_schema: RECIPE_SCHEMA,
    request: { type: "generate", prompt: "a cat <lora:fur:0.6>", inputs: [`upload:${A}`] },
    refs: { [`upload:${A}`]: { kind: "file", frameId: "f1", pictureId: "p1" } },
    map_keys: [],
    settings: { steps: 20 },
    checkpoint: {
      title: "SDXL/juggernaut [0123456789]",
      name: "juggernaut",
      path: "SDXL/juggernaut",
      sha256: null,
      shorthash: "0123456789",
      snapshot: null,
      class_name: null,
      type: "safetensors",
    },
    networks: [{ kind: "lora", name: "fur", sha256: null, short: null }],
    lut: null,
    preview: { thumb: B, width: 4, height: 4 },
    ...overrides,
  };
}

function refusedAt(value: unknown): string {
  try {
    readRecipe(value);
  } catch (err) {
    if (err instanceof UnreadableRecipe) return err.path;
    throw err;
  }
  throw new Error("read");
}

describe("readRecipe", () => {
  it("reads a recipe this build writes", () => {
    const recipe = readRecipe(part());
    expect(recipe.checkpoint?.name).toBe("juggernaut");
    expect(recipe.refs[`upload:${A}`]).toEqual({ kind: "file", frameId: "f1", pictureId: "p1" });
  });

  it("refuses with the path of what it cannot account for", () => {
    expect(refusedAt({ ...part(), surprise: 1 })).toBe("recipe.surprise");
    expect(refusedAt(part({ map_keys: [3] }))).toBe("recipe.map_keys[0]");
    expect(
      refusedAt(
        part({ refs: { [`upload:${B}`]: { kind: "file", frameId: "f", pictureId: "p" } } }),
      ),
    ).toBe(`recipe.refs.upload:${B}`);
    expect(refusedAt(part({ refs: { [`upload:${A}`]: { kind: "lost" } } }))).toBe(
      `recipe.refs.upload:${A}`,
    );
    expect(refusedAt(part({ lut: { name: "warm.cube" } }))).toBe("recipe.lut");
    expect(
      refusedAt(part({ networks: [{ kind: "lora", name: "other", sha256: null, short: null }] })),
    ).toBe("recipe.networks[0]");
    expect(refusedAt(part({ request: { type: "detail" } }))).toBe("recipe.request.type");
    expect(refusedAt(part({ checkpoint: { ...part().checkpoint, shorthash: "xyz" } }))).toBe(
      "recipe.checkpoint.shorthash",
    );
  });

  it("takes a LUT whose bytes travel as the request's upload ref", () => {
    const recipe = readRecipe(
      part({
        request: { type: "generate", prompt: "<lora:fur:1>", grading_lut_file: `upload:${A}` },
        refs: {},
        lut: { name: "warm.cube" },
      }),
    );
    expect(recipe.lut).toEqual({ name: "warm.cube" });
  });

  it("throws NewerRecipe with the schema it saw", () => {
    expect(() => readRecipe(part({ recipe_schema: RECIPE_SCHEMA + 1 }))).toThrow(NewerRecipe);
    try {
      readRecipe(part({ recipe_schema: 7 }));
    } catch (err) {
      expect((err as NewerRecipe).schema).toBe(7);
    }
  });
});

describe("readSettings", () => {
  const defaults = {
    steps: 20,
    prompt: "",
    styles: [] as string[],
    gradingLutHash: null,
    detailerDefaults: {},
  };

  it("keeps the keys the defaults know, with their kind of value", () => {
    const read = readSettings(
      { steps: 30, prompt: "a", styles: ["s"], gradingLutHash: B, detailerDefaults: { steps: 4 } },
      defaults,
    );
    expect(read).toEqual({
      settings: {
        steps: 30,
        prompt: "a",
        styles: ["s"],
        gradingLutHash: B,
        detailerDefaults: { steps: 4 },
      },
      skipped: 0,
    });
  });

  it("drops and counts unknown keys, wrong kinds and the snapshot's dropped keys", () => {
    const read = readSettings(
      { steps: "30", futureKnob: 1, overrideSettings: {}, styles: {} },
      { ...defaults, overrideSettings: {} },
    );
    expect(read).toEqual({ settings: {}, skipped: 4 });
  });
});

describe("readRecipeHead", () => {
  const head = (overrides: Record<string, unknown> = {}) => {
    const { checkpoint, networks, lut, preview } = part();
    return {
      recipe_schema: RECIPE_SCHEMA,
      type: "generate",
      checkpoint,
      networks,
      lut,
      preview: { ...preview, lost: false },
      ...overrides,
    };
  };

  it("reads what a card shows, the preview's lost flag included", () => {
    const read = readRecipeHead(head({ preview: { thumb: B, width: 4, height: 4, lost: true } }));
    expect(read?.checkpoint?.name).toBe("juggernaut");
    expect(read?.networks.map((n) => n.name)).toEqual(["fur"]);
    expect(read?.preview).toEqual({ thumb: B, width: 4, height: 4, lost: true });
  });

  it("keeps a newer schema's number and reads nothing else of it", () => {
    expect(readRecipeHead(head({ recipe_schema: RECIPE_SCHEMA + 1, checkpoint: 7 }))).toEqual({
      schema: RECIPE_SCHEMA + 1,
      checkpoint: null,
      networks: [],
      preview: null,
    });
  });

  it("answers null for a head this build cannot read", () => {
    expect(readRecipeHead(null)).toBeNull();
    expect(readRecipeHead(head({ checkpoint: { name: "x" } }))).toBeNull();
  });
});
