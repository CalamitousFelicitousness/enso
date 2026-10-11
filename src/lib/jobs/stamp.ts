// The job id sdnext's save callback stamps into an output's text as its last
// pair, read back as the server reads it (enso_api/stamp.py).

const TRAILING = /(?:^|,)\s*Enso job:\s*enso-([0-9a-f]+)\s*$/;
const VALUE = /^enso-([0-9a-f]+)$/;

/** The job id of the stamp that ends a text; null without one. */
export function stampIn(text: string | null | undefined): string | null {
  return TRAILING.exec(text ?? "")?.[1] ?? null;
}

/** The text without its trailing stamp; one pasted inside a prompt stays. */
export function stripStamp(text: string): string {
  return text.replace(TRAILING, "");
}

/** The job id in a stamp's value as the server's parse gives it ("enso-<hex>"). */
export function jobIdOf(value: unknown): string | null {
  return typeof value === "string" ? (VALUE.exec(value.trim())?.[1] ?? null) : null;
}
