// Strict readers over values of unknown provenance. Each caller binds its own
// failure, so a document and a recipe refuse with their own error and path.

import { loose, type Loose } from "./loose";
import type { JsonValue } from "./types";

export interface Readers {
  fail: (path: string) => never;
  fields: <T>(value: unknown, path: string) => Loose<T>;
  /** `read` with every key of `raw` accounted for. */
  exact: <T extends object>(raw: Loose<T>, path: string, read: T) => T;
  list: (value: unknown, path: string) => unknown[];
  text: (value: unknown, path: string) => string;
  flag: (value: unknown, path: string) => boolean;
  num: (value: unknown, path: string) => number;
  oneOf: <T extends string>(value: unknown, options: readonly T[], path: string) => T;
  orNull: <T>(raw: unknown, read: (raw: unknown) => T) => T | null;
  json: (value: unknown, path: string) => JsonValue;
}

export function readers(fail: (path: string) => never): Readers {
  const num = (value: unknown, path: string): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fail(path);
  const json = (value: unknown, path: string): JsonValue => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") return num(value, path);
    if (Array.isArray(value)) return value.map((v, i) => json(v, `${path}[${i}]`));
    if (typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, v]) => [key, json(v, `${path}.${key}`)]),
      );
    }
    return fail(path);
  };
  return {
    fail,
    fields: <T>(value: unknown, path: string) => loose<T>(value) ?? fail(path),
    exact: <T extends object>(raw: Loose<T>, path: string, read: T) => {
      for (const key of Object.keys(raw)) {
        if (!Object.hasOwn(read, key)) fail(`${path}.${key}`);
      }
      return read;
    },
    list: (value, path) => (Array.isArray(value) ? value : fail(path)),
    text: (value, path) => (typeof value === "string" ? value : fail(path)),
    flag: (value, path) => (typeof value === "boolean" ? value : fail(path)),
    num,
    oneOf: <T extends string>(value: unknown, options: readonly T[], path: string) =>
      options.find((option) => option === value) ?? fail(path),
    orNull: <T>(raw: unknown, read: (raw: unknown) => T) => (raw === null ? null : read(raw)),
    json,
  };
}
