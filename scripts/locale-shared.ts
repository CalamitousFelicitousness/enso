/**
 * Shared fetch logic between `locale-refresh.ts` and `locale-check.ts`.
 *
 * SD.Next ships its UI hint dictionary as `ui/locale/locale_en.json` and serves
 * it over Gradio's static file route at `/file=ui/locale/locale_en.json`. Each
 * entry is `{id, label, localized, hint, ui, reload?}`; the `hint` field is the
 * tooltip text Enso consumes.
 *
 * The snapshot is committed to `src/data/locale_en.snapshot.json`. The codegen
 * reads it to build the generated hint baseline; the drift-check compares a
 * freshly-fetched copy against it byte-for-byte. The text is stored verbatim
 * (SD.Next serves a static file, so bytes are stable) with a single trailing
 * newline so refresh and check always agree on the comparison form.
 */

import { detectBackendPort } from "../vite/backend-port.ts";

export const LOCALE_RESOURCE = "ui/locale/locale_en.json";

export function normalizeSnapshot(text: string): string {
  return text.endsWith("\n") ? text : text + "\n";
}

export async function fetchLocale(envPort?: string): Promise<string> {
  const port = await detectBackendPort(envPort);
  const url = `http://localhost:${port}/file=${LOCALE_RESOURCE}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  // Validate it parses as the expected section-keyed object before committing it.
  const parsed = JSON.parse(text) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Unexpected locale payload from ${url} (not a JSON object)`);
  }
  return normalizeSnapshot(text);
}

export interface LocaleEntry {
  id: string;
  label: string;
  localized: string;
  hint: string;
  ui?: string;
  reload?: string;
}

export type LocaleDocument = Record<string, LocaleEntry[]>;

export function countHints(snapshot: string): number {
  const doc = JSON.parse(snapshot) as LocaleDocument;
  let n = 0;
  for (const entries of Object.values(doc)) {
    for (const entry of entries) {
      if (entry.hint) n += 1;
    }
  }
  return n;
}
