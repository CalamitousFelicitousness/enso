import { describe, expect, it } from "vitest";
import { recipeLoad, requestHashes, type RecipeEntry } from "./load";
import type { Recipe } from "./recipe";

const A = "a".repeat(64);
const B = "b".repeat(64);

const recipe: Recipe = {
  recipe_schema: 1,
  request: { type: "generate", prompt: "a cat", inputs: [`upload:${A}`], mask: `upload:${B}` },
  refs: {
    [`upload:${A}`]: {
      kind: "composite",
      frameId: "f1",
      drawnAt: { width: 8, height: 8 },
      encode: null,
    },
  },
  map_keys: ["k1"],
  settings: {},
  checkpoint: {
    title: "SDXL/juggernaut [0123456789]",
    name: "juggernaut",
    path: "SDXL/juggernaut",
    sha256: null,
    shorthash: "0123456789",
    snapshot: null,
    class_name: null,
    type: null,
  },
  networks: [],
  lut: null,
  preview: null,
};

const entry: RecipeEntry = {
  id: "e1",
  savedAt: 5,
  inputs: null,
  maps: { k2: "m2" },
  hashes: { m2: "c".repeat(64) },
  lost: ["x"],
  unavailable: ["y"],
};

describe("recipeLoad", () => {
  it("names the request's uploads by hash", () => {
    expect(requestHashes(recipe).sort()).toEqual([A, B]);
  });

  it("is the record a replay sends: the recipe's request, sources and keys over the entry", () => {
    const load = recipeLoad(entry, recipe, new Set([B]));
    expect(load.record).toMatchObject({
      id: "e1",
      domain: "generate",
      createdAt: 5,
      checkpoint: { title: "SDXL/juggernaut [0123456789]", name: "juggernaut" },
      request: recipe.request,
      refs: recipe.refs,
      inputs: null,
      mapKeys: ["k1"],
      maps: { k2: "m2" },
    });
    expect(load.missingRefs).toEqual([`upload:${B}`]);
    expect([...load.unheld].sort()).toEqual(["x", "y"]);
    expect(load.legacy).toBe(false);
  });

  it("leaves the checkpoint out for a recipe without one", () => {
    expect(recipeLoad(entry, { ...recipe, checkpoint: null }, new Set()).record.checkpoint).toBe(
      null,
    );
  });
});
