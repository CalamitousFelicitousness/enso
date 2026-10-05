/** An object of unknown provenance read as T: the field names are known,
 * nothing about their values is. */
export type Loose<T> = { [K in keyof T]?: unknown };

/** The value as a Loose<T>, or null when it is not a plain object. */
export function loose<T>(value: unknown): Loose<T> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
