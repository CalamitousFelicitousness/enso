// The records builds before the input document left: the canvas record in
// its two formats and the control units. Read only, and without stores, so a
// reset can mark them as brought in before the app starts.

import type { StorageValue } from "zustand/middleware";
import { legacyReader } from "@/lib/idbStorage";
import { legacyFingerprint } from "@/lib/inputs/legacy";
import { controlFingerprint } from "@/lib/inputs/legacyControl";
import { loose } from "@/lib/inputs/loose";
import { DB, RECORD, STATE_STORE } from "@/lib/profile/names";

/** The canvas record's formats, newest first. Version 3 is a JSON string. */
const LEGACY = [
  { id: "canvas-v4", key: RECORD.canvasV4, version: 4 },
  { id: "canvas-v3", key: RECORD.canvasV3, version: 3 },
] as const;

const legacyCanvas = legacyReader(DB.canvas, STATE_STORE);

export interface FoundSource {
  id: string;
  /** Null when storage holds no record of this format. */
  fingerprint: string | null;
  /** The record's state, when it was read to be fingerprinted. */
  state?: unknown;
}

/** The state of a legacy record of the version its key should hold, else null. */
function stateOf(raw: unknown, version: number): unknown {
  const stored = loose<StorageValue<unknown>>(typeof raw === "string" ? JSON.parse(raw) : raw);
  return stored?.version === version ? (stored.state ?? null) : null;
}

/** Every format of the legacy canvas record, newest first, with a fingerprint
 * for those storage holds. A record stored as text is parsed only while it
 * could still be the one to import: nothing imported yet and no newer record.
 * After that it is not watched, and stands for itself. */
export async function findSources(imports: Record<string, string>): Promise<FoundSource[]> {
  const known = LEGACY.some((format) => imports[format.id] !== undefined);
  const sources: FoundSource[] = [];
  let newerFound = false;
  for (const { id, key, version } of LEGACY) {
    const raw = await legacyCanvas.get(key);
    if (raw === null || raw === undefined) {
      sources.push({ id, fingerprint: null });
    } else if (typeof raw === "string" && (known || newerFound)) {
      sources.push({ id, fingerprint: "unread" });
    } else {
      const state = stateOf(raw, version);
      sources.push({ id, fingerprint: legacyFingerprint(state), state });
    }
    newerFound ||= raw !== null && raw !== undefined;
  }
  return sources;
}

/** The control units record older builds kept beside the canvas: one format. */
export const CONTROL_SOURCE = "control-v1";
const legacyControl = legacyReader(DB.control, STATE_STORE);

export async function findControlSource(): Promise<FoundSource> {
  const raw = await legacyControl.get(RECORD.control);
  if (raw === null || raw === undefined) return { id: CONTROL_SOURCE, fingerprint: null };
  return { id: CONTROL_SOURCE, fingerprint: controlFingerprint(raw), state: raw };
}

/** Marks for every legacy record there is, as if each had been imported. For
 * a document started empty on purpose, which should stay empty. */
export async function legacyMarks(): Promise<Record<string, string>> {
  try {
    const found = [...(await findSources({})), await findControlSource()];
    return Object.fromEntries(
      found.flatMap((s) => (s.fingerprint === null ? [] : [[s.id, s.fingerprint]])),
    );
  } catch {
    return {};
  }
}
