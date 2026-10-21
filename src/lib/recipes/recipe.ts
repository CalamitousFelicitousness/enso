// A recipe as the library keeps it: the request a generation sends, what its
// pictures are made from, the settings Restore reads, and the models it ran with.

import type { GenerationState } from "@/stores/generationStore";
import { isUploadRef, refsIn } from "@/lib/jobs/replay";
import { readers } from "@/lib/inputs/read";
import { readSource, UnreadableDocument, type Source } from "@/lib/inputs/stored";
import type { JsonValue } from "@/lib/inputs/types";
import { networksIn, type NetworkKind } from "./networks";
import portable from "./portable.json";

export const RECIPE_SCHEMA = 1;
export const RECIPE_EXT = ".enso";

export function isRecipeFile(file: { name: string }): boolean {
  return file.name.toLowerCase().endsWith(RECIPE_EXT);
}

/** What the canvas takes: a picture, or a recipe file it imports. */
export function isPictureOrRecipe(file: { name: string; type: string }): boolean {
  return file.type.startsWith("image/") || isRecipeFile(file);
}

/** A model as the server that saved the recipe knew it. */
export interface ModelId {
  title: string;
  name: string;
  path: string;
  sha256: string | null;
  shorthash: string | null;
  snapshot: string | null;
  class_name: string | null;
  type: string | null;
}

export interface NetworkId {
  kind: NetworkKind;
  name: string;
  sha256: string | null;
  /** The hash sdnext showed for it, of a kind sdnext does not say. */
  short: string | null;
}

/** Generation settings as the store holds them, the keys the defaults know. */
export type RecipeSettings = Partial<GenerationState>;

export interface Recipe {
  recipe_schema: number;
  request: Record<string, JsonValue>;
  refs: Record<string, Source>;
  map_keys: string[];
  settings: Record<string, JsonValue>;
  checkpoint: ModelId | null;
  networks: NetworkId[];
  lut: { name: string } | null;
  preview: { thumb: string; width: number; height: number } | null;
}

/** A recipe part this build cannot account for. */
export class UnreadableRecipe extends Error {
  override name = "UnreadableRecipe";
  readonly path: string;
  constructor(path: string) {
    super(`recipe: unexpected value at ${path}`);
    this.path = path;
  }
}

/** A recipe saved by a build with a newer recipe schema. */
export class NewerRecipe extends Error {
  override name = "NewerRecipe";
  readonly schema: number;
  constructor(schema: number) {
    super(`recipe: schema ${schema} is newer than ${RECIPE_SCHEMA}`);
    this.schema = schema;
  }
}

const read = readers((path) => {
  throw new UnreadableRecipe(path);
});
const HASH = /^[0-9a-f]{64}$/;
const SHORTHASH = /^[0-9a-f]{10}$/;

function hash(value: unknown, path: string): string | null {
  return read.orNull(value, (raw) =>
    typeof raw === "string" && HASH.test(raw) ? raw : read.fail(path),
  );
}

function optional(value: unknown, path: string): string | null {
  return value === undefined ? null : read.orNull(value, (raw) => read.text(raw, path));
}

function modelId(value: unknown, path: string): ModelId {
  const m = read.fields<ModelId>(value, path);
  const shorthash = optional(m.shorthash, `${path}.shorthash`);
  if (shorthash !== null && !SHORTHASH.test(shorthash)) read.fail(`${path}.shorthash`);
  return read.exact<ModelId>(m, path, {
    title: read.text(m.title, `${path}.title`),
    name: read.text(m.name, `${path}.name`),
    path: m.path === undefined ? "" : read.text(m.path, `${path}.path`),
    sha256: m.sha256 === undefined ? null : hash(m.sha256, `${path}.sha256`),
    shorthash,
    snapshot: optional(m.snapshot, `${path}.snapshot`),
    class_name: optional(m.class_name, `${path}.class_name`),
    type: optional(m.type, `${path}.type`),
  });
}

function networkId(value: unknown, path: string): NetworkId {
  const n = read.fields<NetworkId>(value, path);
  return read.exact<NetworkId>(n, path, {
    kind: read.oneOf(n.kind, ["lora", "lyco"] as const, `${path}.kind`),
    name: read.text(n.name, `${path}.name`),
    sha256: n.sha256 === undefined ? null : hash(n.sha256, `${path}.sha256`),
    short: optional(n.short, `${path}.short`),
  });
}

function record(value: unknown, path: string): Record<string, JsonValue> {
  const json = read.json(value, path);
  return typeof json === "object" && json !== null && !Array.isArray(json) ? json : read.fail(path);
}

function source(value: unknown, path: string): Source {
  try {
    return readSource(value, path);
  } catch (err) {
    if (err instanceof UnreadableDocument) read.fail(path);
    throw err;
  }
}

function promptText(request: Record<string, JsonValue>, key: string): string {
  const value = request[key];
  return typeof value === "string" ? value : "";
}

/** The recipe part of a library entry, read strictly: a newer schema throws
 * `NewerRecipe`, anything else this build cannot account for `UnreadableRecipe`. */
export function readRecipe(value: unknown): Recipe {
  const r = read.fields<Recipe>(value, "recipe");
  const schema = read.num(r.recipe_schema, "recipe.recipe_schema");
  if (schema > RECIPE_SCHEMA) throw new NewerRecipe(schema);
  if (schema !== RECIPE_SCHEMA) read.fail("recipe.recipe_schema");

  const request = record(r.request, "recipe.request");
  if (request["type"] !== "generate") read.fail("recipe.request.type");
  const named = new Set(refsIn(request));
  const refs: Record<string, Source> = {};
  for (const [ref, from] of Object.entries(
    read.fields<Record<string, unknown>>(r.refs ?? {}, "recipe.refs"),
  )) {
    if (!named.has(ref)) read.fail(`recipe.refs.${ref}`);
    refs[ref] = source(from, `recipe.refs.${ref}`);
  }
  const lut =
    r.lut === undefined || r.lut === null
      ? null
      : (() => {
          const l = read.fields<{ name: string }>(r.lut, "recipe.lut");
          return read.exact(l, "recipe.lut", { name: read.text(l.name, "recipe.lut.name") });
        })();
  if (lut && !isUploadRef(request["grading_lut_file"])) read.fail("recipe.lut");

  const prompted = new Set(
    networksIn(promptText(request, "prompt"), promptText(request, "negative_prompt")).map(
      (n) => `${n.kind}:${n.name}`,
    ),
  );
  const networks = read
    .list(r.networks ?? [], "recipe.networks")
    .map((n, i) => networkId(n, `recipe.networks[${i}]`));
  networks.forEach((n, i) => {
    if (!prompted.has(`${n.kind}:${n.name}`)) read.fail(`recipe.networks[${i}]`);
  });

  const preview =
    r.preview === undefined || r.preview === null
      ? null
      : (() => {
          const p = read.fields<NonNullable<Recipe["preview"]>>(r.preview, "recipe.preview");
          const thumb = read.text(p.thumb, "recipe.preview.thumb");
          if (!HASH.test(thumb)) read.fail("recipe.preview.thumb");
          return read.exact(p, "recipe.preview", {
            thumb,
            width: read.num(p.width, "recipe.preview.width"),
            height: read.num(p.height, "recipe.preview.height"),
          });
        })();

  return read.exact<Recipe>(r, "recipe", {
    recipe_schema: schema,
    request,
    refs,
    map_keys: read
      .list(r.map_keys ?? [], "recipe.map_keys")
      .map((k, i) => read.text(k, `recipe.map_keys[${i}]`)),
    settings: record(r.settings ?? {}, "recipe.settings"),
    checkpoint:
      r.checkpoint === undefined
        ? null
        : read.orNull(r.checkpoint, (raw) => modelId(raw, "recipe.checkpoint")),
    networks,
    lut,
    preview,
  });
}

/** What a library list shows of a recipe, as the server derives it. */
export interface RecipeHead {
  schema: number;
  checkpoint: ModelId | null;
  networks: NetworkId[];
  preview: { thumb: string; width: number; height: number; lost: boolean } | null;
}

/** A list item's recipe head, the part a card shows; null for a head this
 * build cannot read, which lists as saved by a newer version when its schema
 * says so. */
export function readRecipeHead(value: unknown): RecipeHead | null {
  try {
    const h = read.fields<Record<string, unknown>>(value, "head");
    const schema = read.num(h["recipe_schema"], "head.recipe_schema");
    if (schema > RECIPE_SCHEMA) return { schema, checkpoint: null, networks: [], preview: null };
    const p = h["preview"];
    const preview =
      p === undefined || p === null
        ? null
        : (() => {
            const f = read.fields<Record<string, unknown>>(p, "head.preview");
            return {
              thumb: read.text(f["thumb"], "head.preview.thumb"),
              width: read.num(f["width"], "head.preview.width"),
              height: read.num(f["height"], "head.preview.height"),
              lost: f["lost"] === true,
            };
          })();
    return {
      schema,
      checkpoint: read.orNull(h["checkpoint"] ?? null, (raw) => modelId(raw, "head.checkpoint")),
      networks: read
        .list(h["networks"] ?? [], "head.networks")
        .map((n, i) => networkId(n, `head.networks[${i}]`)),
      preview,
    };
  } catch (err) {
    if (err instanceof UnreadableRecipe) return null;
    throw err;
  }
}

/** A settings snapshot as this build's store can take it: keys the defaults
 * know, with the default's kind of value. The snapshot grows every release,
 * so the rest is dropped and counted, never refused. */
export function readSettings(
  value: Record<string, JsonValue>,
  defaults: Readonly<Record<string, unknown>>,
): { settings: RecipeSettings; skipped: number } {
  const dropped = new Set(portable.settingsDrop);
  const settings: Record<string, unknown> = {};
  let skipped = 0;
  for (const [key, v] of Object.entries(value)) {
    const fallback = defaults[key];
    if (dropped.has(key) || !Object.hasOwn(defaults, key) || !sameKind(v, fallback)) {
      skipped++;
      continue;
    }
    settings[key] = v;
  }
  return { settings: settings, skipped };
}

function sameKind(value: unknown, fallback: unknown): boolean {
  if (fallback === null) return value === null || typeof value === "string";
  if (Array.isArray(fallback)) return Array.isArray(value);
  if (typeof fallback === "object")
    return typeof value === "object" && value !== null && !Array.isArray(value);
  return typeof value === typeof fallback;
}
