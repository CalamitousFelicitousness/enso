// Everything Enso keeps in this browser, each with the part of a reset that
// deletes it.

import { META_KEY, type MetaKey } from "@/lib/inputs/metaKeys";
import {
  BLOBS,
  DOCUMENTS,
  HASHES,
  JOBS,
  LIBRARY,
  MAPS,
  SNAPSHOTS,
  TRASH,
} from "@/lib/inputs/storeLayout";
import { DB, LOCAL, RECORD, STATE_STORE, type DbName, type LocalKey } from "./names";

/** What a reset deletes together. */
export type ProfileGroup =
  /** The inputs and their trash, the results on the strips, the video inputs. */
  | "work"
  /** The prompt and every setting of the views. */
  | "parameters"
  /** Presets and the prompt history. */
  | "saved"
  /** Layout, appearance and behavior. */
  | "interface"
  /** The server address, the sign-in and this browser's name on the server. */
  | "connection"
  /** What older builds kept here that has not moved to the server. */
  | "legacy"
  /** What is fetched or worked out again, and the first-run marker: these go
   * only when every content row does. */
  | "caches";

/** The groups a reset offers to choose, in the order it shows them. */
export type ResetRow = Exclude<ProfileGroup, "caches">;

export const RESET_ROWS: readonly ResetRow[] = [
  "work",
  "parameters",
  "saved",
  "interface",
  "connection",
  "legacy",
];

/** The rows that hold what the user made and set; all four make a full reset. */
export const CONTENT_ROWS: readonly ResetRow[] = ["work", "parameters", "saved", "interface"];

export type ProfileEntry =
  /** A localStorage key. `fields` of its state belong to another group. */
  | {
      kind: "local";
      key: LocalKey;
      group: ProfileGroup;
      fields?: { group: ProfileGroup; names: readonly string[] };
    }
  /** A database that belongs to one group whole. */
  | { kind: "database"; db: DbName; group: ProfileGroup }
  /** A record of a database whose records belong to different groups. */
  | { kind: "record"; db: DbName; store: string; key: string; group: ProfileGroup }
  /** An object store of enso-inputs. Blobs and hashes rows go only once
   * nothing left names them. */
  | { kind: "store"; store: string; group: ProfileGroup }
  /** A key of enso-inputs' meta store. */
  | { kind: "meta"; key: MetaKey; group: ProfileGroup };

const STRIP_LIMIT = { group: "work", names: ["historyLimit"] } as const;

export const MANIFEST: readonly ProfileEntry[] = [
  { kind: "store", store: DOCUMENTS, group: "work" },
  { kind: "store", store: TRASH, group: "work" },
  { kind: "store", store: MAPS, group: "work" },
  { kind: "store", store: SNAPSHOTS, group: "work" },
  { kind: "store", store: BLOBS, group: "work" },
  { kind: "store", store: HASHES, group: "work" },
  { kind: "store", store: JOBS, group: "legacy" },
  { kind: "store", store: LIBRARY, group: "legacy" },
  { kind: "meta", key: META_KEY.reclaim, group: "work" },
  { kind: "meta", key: META_KEY.orphans, group: "work" },
  { kind: "meta", key: META_KEY.hashOrphans, group: "work" },
  { kind: "meta", key: META_KEY.migrateSilenced, group: "legacy" },
  { kind: "meta", key: META_KEY.client, group: "connection" },
  { kind: "meta", key: META_KEY.migrateTarget, group: "connection" },
  { kind: "meta", key: META_KEY.trashDays, group: "caches" },
  { kind: "record", db: DB.canvas, store: STATE_STORE, key: RECORD.canvasV4, group: "work" },
  { kind: "record", db: DB.canvas, store: STATE_STORE, key: RECORD.canvasV3, group: "work" },
  { kind: "record", db: DB.canvas, store: STATE_STORE, key: RECORD.canvas, group: "interface" },
  { kind: "database", db: DB.control, group: "work" },
  { kind: "database", db: DB.videoCanvas, group: "work" },
  { kind: "database", db: DB.history, group: "work" },
  { kind: "database", db: DB.videoHistory, group: "work" },
  { kind: "database", db: DB.colorLut, group: "parameters" },
  { kind: "database", db: DB.thumbs, group: "caches" },
  { kind: "database", db: DB.dicts, group: "caches" },
  { kind: "local", key: LOCAL.videoHashes, group: "work" },
  { kind: "local", key: LOCAL.generation, group: "parameters", fields: STRIP_LIMIT },
  { kind: "local", key: LOCAL.video, group: "parameters", fields: STRIP_LIMIT },
  { kind: "local", key: LOCAL.img2img, group: "parameters" },
  { kind: "local", key: LOCAL.process, group: "parameters" },
  { kind: "local", key: LOCAL.processLut, group: "parameters" },
  { kind: "local", key: LOCAL.captionSettings, group: "parameters" },
  { kind: "local", key: LOCAL.enhance, group: "parameters" },
  { kind: "local", key: LOCAL.cloudText, group: "parameters" },
  { kind: "local", key: LOCAL.modelSelection, group: "parameters" },
  { kind: "local", key: LOCAL.generationPresets, group: "saved" },
  { kind: "local", key: LOCAL.videoPresets, group: "saved" },
  { kind: "local", key: LOCAL.promptHistory, group: "saved" },
  { kind: "local", key: LOCAL.ui, group: "interface" },
  { kind: "local", key: LOCAL.tutorial, group: "interface" },
  { kind: "local", key: LOCAL.gallerySort, group: "interface" },
  { kind: "local", key: LOCAL.galleryPictureOnly, group: "interface" },
  { kind: "local", key: LOCAL.connections, group: "connection" },
  { kind: "local", key: LOCAL.sessionMode, group: "connection" },
  { kind: "local", key: LOCAL.client, group: "connection" },
  { kind: "local", key: LOCAL.modelCapabilities, group: "caches" },
  { kind: "local", key: LOCAL.modelDownloads, group: "caches" },
  { kind: "local", key: LOCAL.profile, group: "caches" },
];
