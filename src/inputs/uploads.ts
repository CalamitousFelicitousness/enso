// One batch per action sends every upload the action needs. It claims first,
// with each hash this browser remembers and the bytes the rest will take, so
// the server's answer decides before any byte goes; then it uploads what the
// server lacks, two at a time, with progress by bytes. Three memories make a
// repeated action a claim instead of an upload: the hashes store by cid, and
// for the page's life derived bytes by what made them and other bytes by their
// Blob. A memory never answers alone: the claim decides.

import { claim, ingest } from "@/api/blobs";
import { UserAbortError } from "@/lib/abort";
import { newId } from "@/lib/id";
import { UploadRefused } from "@/lib/media/refused";
import type { Source } from "@/lib/inputs/stored";
import type { Size } from "@/lib/inputs/types";
import { UPLOAD_PREFIX } from "@/lib/jobs/replay";
import {
  claimBytes,
  planBatch,
  progressOf,
  roomOf,
  type BatchProgress,
  type PlanItem,
  type UploadShare,
} from "@/lib/media/batch";
import { isGone, STAGED_PREFIX, type Outcome } from "@/lib/media/stage";
import { readBlob, readHashes, rememberHashes, type Hashed } from "./db";

/** The bytes to send, a way to make them once they must go, or none. */
export type Bytes = Blob | (() => Promise<Blob | null>) | null;

export interface StageOptions {
  /** The file name the server keeps for downloads, and the words name. */
  name: string;
  /** The picture's cid: the hash of its bytes is remembered on disk. */
  cid?: string;
  /** What derived bytes were made from: their hash is remembered for the page's life. */
  key?: string;
  /** The hashes row derived bytes' hash is kept under across reloads. */
  row?: string;
  /** The hash a server record pairs these bytes with. */
  hash?: string;
  /** The size derived bytes were made at, remembered with their hash. */
  dims?: Size;
  /** Bytes read once (PNG info, captions): the server keeps them an hour. */
  transient?: boolean;
  /** Kept with a job's record only: never fails the batch. */
  record?: boolean;
  /** Bytes a setting names, such as a LUT, not one of the action's files. */
  setting?: boolean;
  /** Where the bytes come from, named when they are gone. */
  source?: Source;
  /** Told the hash the server holds the bytes under, held or sent. */
  onHash?: (hashed: Hashed) => void;
}

export interface Staged {
  readonly ref: string;
}

/** Derived bytes this page sent, by what made them. */
export interface Derived extends Hashed {
  width: number;
  height: number;
  name: string;
}

const derived = new Map<string, Derived>();
const byBlob = new WeakMap<Blob, Hashed>();

/** What derived bytes made from `key` hashed to, when this page sent them. */
export function derivedFor(key: string): Derived | undefined {
  return derived.get(key);
}

interface Item {
  ref: string;
  bytes: Bytes;
  name: string;
  cid: string | undefined;
  key: string | undefined;
  row: string | undefined;
  hash: string | undefined;
  dims: Size | undefined;
  transient: boolean;
  record: boolean;
  setting: boolean;
  source: Source | undefined;
  onHash: ((hashed: Hashed) => void) | undefined;
}

const AT_ONCE = 2;

function gone(item: Item): Outcome {
  return item.source ? { gone: true, source: item.source } : { gone: true };
}

/** Whether a Blob can still be read: a dropped file moved or changed on disk cannot.
 * Chromium sizes a deleted file 0, and an empty slice reads without opening the file. */
async function readable(blob: Blob): Promise<boolean> {
  if (blob.size === 0) return false;
  try {
    await blob.slice(0, 1).arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

/** What a batch reaches outside the page: the server and this browser's stores. */
export interface BatchTools {
  claim: typeof claim;
  ingest: typeof ingest;
  readHashes: typeof readHashes;
  rememberHashes: typeof rememberHashes;
  readBlob: typeof readBlob;
}

const TOOLS: BatchTools = { claim, ingest, readHashes, rememberHashes, readBlob };

export interface BatchOptions {
  signal?: AbortSignal;
  onProgress?: (progress: BatchProgress) => void;
  /** Items are read once unless staged otherwise. */
  transient?: boolean;
  tools?: Partial<BatchTools>;
}

export class UploadBatch {
  private readonly label: string;
  private readonly signal: AbortSignal | undefined;
  private readonly onProgress: ((progress: BatchProgress) => void) | undefined;
  private readonly transient: boolean;
  private readonly tools: BatchTools;
  private readonly items: Item[] = [];
  private readonly byCid = new Map<string, Item>();
  private readonly byKey = new Map<string, Item>();
  private readonly byHash = new Map<string, Item>();
  private readonly byBytes = new Map<Blob, Item>();
  private running: Promise<ReadonlyMap<string, Outcome>> | null = null;
  private outcomes: ReadonlyMap<string, Outcome> | null = null;
  private leftOut: { count: number; room: number } | null = null;

  /** `label` names the action in the log. */
  constructor(label: string, options: BatchOptions = {}) {
    this.label = label;
    this.signal = options.signal;
    this.onProgress = options.onProgress;
    this.transient = options.transient ?? false;
    this.tools = { ...TOOLS, ...options.tools };
  }

  /** Add bytes to send; the same cid, key, hash or Blob staged twice is one
   * item, and a request's need outranks a record's. */
  stage(bytes: Bytes, options: StageOptions): Staged {
    if (this.running) throw new Error("This batch already runs; stage on a new one");
    const same = this.find(bytes, options);
    if (same) {
      same.record &&= options.record ?? false;
      same.setting &&= options.setting ?? false;
      same.transient &&= options.transient ?? this.transient;
      if (same.bytes === null) same.bytes = bytes;
      same.cid ??= options.cid;
      same.key ??= options.key;
      same.row ??= options.row;
      same.hash ??= options.hash;
      same.dims ??= options.dims;
      same.source ??= options.source;
      same.onHash ??= options.onHash;
      this.index(same, bytes);
      return { ref: same.ref };
    }
    const item: Item = {
      ref: `${STAGED_PREFIX}${newId()}`,
      bytes,
      name: options.name,
      cid: options.cid,
      key: options.key,
      row: options.row,
      hash: options.hash,
      dims: options.dims,
      transient: options.transient ?? this.transient,
      record: options.record ?? false,
      setting: options.setting ?? false,
      source: options.source,
      onHash: options.onHash,
    };
    this.items.push(item);
    this.index(item, bytes);
    return { ref: item.ref };
  }

  /** Send what the server lacks; each staged ref's outcome. Runs once. */
  run(): Promise<ReadonlyMap<string, Outcome>> {
    this.running ??= this.go().then((outcomes) => {
      this.outcomes = outcomes;
      return outcomes;
    });
    return this.running;
  }

  /** The record-only items left out because the server had no room, and the
   * room it had; null when none was. */
  get keptOut(): { count: number; room: number } | null {
    return this.leftOut;
  }

  /** A batch with the same items under the same refs, not run yet, so a
   * request staged on this one stays valid: a Retry after a failed run, or,
   * with `hashes`, the items whose bytes went out under one of them, for a
   * server that no longer holds those. */
  again(options: BatchOptions = {}, hashes?: ReadonlySet<string>): UploadBatch {
    const next = new UploadBatch(this.label, {
      tools: this.tools,
      transient: this.transient,
      ...(this.signal ? { signal: this.signal } : {}),
      ...(this.onProgress ? { onProgress: this.onProgress } : {}),
      ...options,
    });
    for (const item of this.items) {
      if (hashes && !hashes.has(this.hashOf(item.ref) ?? "")) continue;
      const copy = { ...item };
      next.items.push(copy);
      next.index(copy, copy.bytes);
    }
    return next;
  }

  /** The name of the first item whose bytes went out under each of `hashes`;
   * a hash no item sent is absent. */
  namesOf(hashes: ReadonlySet<string>): Map<string, string> {
    const names = new Map<string, string>();
    for (const item of this.items) {
      const hash = this.hashOf(item.ref);
      if (hash && hashes.has(hash) && !names.has(hash)) names.set(hash, item.name);
    }
    return names;
  }

  private hashOf(ref: string): string | null {
    const outcome = this.outcomes?.get(ref);
    return outcome && !isGone(outcome) ? outcome.hash : null;
  }

  private find(bytes: Bytes, options: StageOptions): Item | undefined {
    if (options.cid && this.byCid.has(options.cid)) return this.byCid.get(options.cid);
    if (options.key && this.byKey.has(options.key)) return this.byKey.get(options.key);
    if (options.hash && this.byHash.has(options.hash)) return this.byHash.get(options.hash);
    return bytes instanceof Blob ? this.byBytes.get(bytes) : undefined;
  }

  private index(item: Item, bytes: Bytes): void {
    if (item.cid) this.byCid.set(item.cid, item);
    if (item.key) this.byKey.set(item.key, item);
    if (item.hash) this.byHash.set(item.hash, item);
    if (bytes instanceof Blob) this.byBytes.set(bytes, item);
  }

  private report(progress: BatchProgress): void {
    this.onProgress?.(progress);
  }

  private check(): void {
    if (this.signal?.aborted) throw new UserAbortError("Upload cancelled");
  }

  /** What the browser remembers of an item's bytes: a hash it was given, the
   * hashes row of its cid, the hash of what made it, or of its Blob. A row of
   * another size than the bytes staged names other bytes, and is not used. */
  private remembered(item: Item, rows: ReadonlyMap<string, Hashed>): Hashed | undefined {
    const stored = rows.get(item.cid ?? item.row ?? "");
    const row =
      stored && item.bytes instanceof Blob && stored.size !== item.bytes.size ? undefined : stored;
    const size = item.bytes instanceof Blob ? item.bytes.size : row?.size;
    if (item.hash) return { hash: item.hash, size: size ?? 0 };
    if (row) return row;
    const made = item.key ? derived.get(item.key) : undefined;
    if (made) return { hash: made.hash, size: made.size };
    return item.bytes instanceof Blob ? byBlob.get(item.bytes) : undefined;
  }

  private async go(): Promise<ReadonlyMap<string, Outcome>> {
    const outcomes = new Map<string, Outcome>();
    if (this.items.length === 0) return outcomes;
    this.check();
    this.report({ phase: "claiming", sent: 0, total: 0, done: 0, files: 0 });
    const cids = [
      ...new Set(this.items.flatMap((item) => [item.cid, item.row].filter((k) => k !== undefined))),
    ];
    const rows = await this.tools.readHashes(cids).catch((err: unknown) => {
      console.warn(`[uploads] ${this.label}: the remembered hashes could not be read`, err);
      return new Map<string, Hashed>();
    });
    const known = new Map<Item, Hashed>();
    for (const item of this.items) {
      const memory = this.remembered(item, rows);
      if (memory) known.set(item, memory);
    }
    const plan: PlanItem[] = this.items.map((item) => ({
      id: item.ref,
      hash: known.get(item)?.hash ?? null,
      size: known.get(item)?.size ?? (item.bytes instanceof Blob ? item.bytes.size : null),
      record: item.record,
    }));
    const hashes = [...new Set(plan.flatMap((p) => (p.hash ? [p.hash] : [])))];
    const claimed = claimBytes(plan);
    // bytes read once stay transient, so a claim of only those does not keep them
    const keep = !this.items.every((item) => item.transient);
    const answer = await this.tools.claim(hashes, claimed, {
      keep,
      ...(this.signal ? { signal: this.signal } : {}),
    });
    const decided = planBatch(plan, answer, claimed);
    if (decided.refused) throw new UploadRefused({ kind: "space", ...decided.refused });
    const byRef = new Map(this.items.map((item) => [item.ref, item]));
    await this.refuseUnreadable(decided.upload.map((ref) => byRef.get(ref)!));
    const newRows = new Map<string, Hashed>();
    for (const [ref, hash] of decided.held) {
      const item = byRef.get(ref)!;
      const size = known.get(item)?.size ?? 0;
      outcomes.set(ref, { ref: `${UPLOAD_PREFIX}${hash}`, hash, size });
      this.remember(item, null, { hash, size }, rows, newRows);
    }
    for (const ref of decided.leftOut) outcomes.set(ref, gone(byRef.get(ref)!));
    if (decided.leftOut.length > 0) {
      this.leftOut = { count: decided.leftOut.length, room: roomOf(answer.space, claimed) };
      console.info(
        `[uploads] ${this.label}: ${decided.leftOut.length} kept-only pictures left out for space`,
      );
    }
    try {
      await this.uploadAll(
        decided.upload.map((ref) => byRef.get(ref)!),
        outcomes,
        rows,
        newRows,
      );
    } finally {
      if (newRows.size > 0) {
        await this.tools.rememberHashes(newRows).catch((err: unknown) => {
          console.warn(`[uploads] ${this.label}: the hashes could not be remembered`, err);
        });
      }
    }
    return outcomes;
  }

  private async uploadAll(
    items: Item[],
    outcomes: Map<string, Outcome>,
    rows: ReadonlyMap<string, Hashed>,
    newRows: Map<string, Hashed>,
  ): Promise<void> {
    if (items.length === 0) return;
    const shares = new Map<Item, UploadShare>(
      items.map((item) => [
        item,
        { sent: 0, total: item.bytes instanceof Blob ? item.bytes.size : 0, done: false },
      ]),
    );
    const report = () => this.report(progressOf(shares.values()));
    report();
    const queue = [...items];
    const inner = new AbortController();
    const stop = () => inner.abort();
    this.signal?.addEventListener("abort", stop, { once: true });
    // the first failure stops both workers; the other's abort is not the reason
    const stopped: { failure: Error | null } = { failure: null };
    const worker = async () => {
      for (let item = queue.shift(); item && !stopped.failure; item = queue.shift()) {
        const share = shares.get(item)!;
        try {
          const blob = await this.bytesOf(item);
          if (!blob) {
            outcomes.set(item.ref, gone(item));
          } else {
            share.total = blob.size;
            report();
            const answer = await this.tools.ingest(blob, {
              name: item.name,
              transient: item.transient,
              signal: inner.signal,
              onProgress: (sent) => {
                share.sent = sent;
                report();
              },
            });
            outcomes.set(item.ref, { ref: answer.ref, hash: answer.hash, size: answer.size });
            this.remember(item, blob, { hash: answer.hash, size: answer.size }, rows, newRows);
          }
        } catch (err) {
          if (!item.record || err instanceof UserAbortError) {
            stopped.failure ??= err instanceof Error ? err : new Error(String(err));
            inner.abort();
            return;
          }
          console.warn(`[uploads] ${this.label}: ${item.name} was not kept with the record`, err);
          outcomes.set(item.ref, gone(item));
        }
        share.done = true;
        report();
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(AT_ONCE, items.length) }, worker));
    } finally {
      this.signal?.removeEventListener("abort", stop);
    }
    this.check();
    if (stopped.failure) throw stopped.failure;
  }

  /** Before any byte goes, refuse the request's files that can no longer be
   * read, all of them by name. A picture with a cid has its stored copy to
   * fall back on, and made bytes and a setting's are read when they go. */
  private async refuseUnreadable(uploading: readonly Item[]): Promise<void> {
    const file = (item: Item): item is Item & { bytes: Blob } =>
      !item.record && !item.setting && item.bytes instanceof Blob;
    const files = this.items.filter(file);
    const checked = uploading.filter(file).filter((item) => !item.cid);
    const readability = await Promise.all(checked.map((item) => readable(item.bytes)));
    this.check();
    const unreadable = checked.filter((_, i) => !readability[i]);
    if (unreadable.length > 0) {
      throw new UploadRefused({
        kind: "unreadable",
        names: unreadable.map((item) => item.name),
        total: files.length,
        refs: unreadable.map((item) => item.ref),
      });
    }
  }

  /** An item's bytes: as staged or made, else the stored copy of its cid when
   * its own Blob can no longer be read. Null when there are none; a request's
   * file that cannot be read is refused by name. */
  private async bytesOf(item: Item): Promise<Blob | null> {
    const made = typeof item.bytes === "function" ? await item.bytes() : item.bytes;
    if (made && (await readable(made))) return made;
    const stored = item.cid ? await this.tools.readBlob(item.cid).catch(() => null) : null;
    if (stored && (await readable(stored))) return stored;
    if (made && !item.record) {
      throw new UploadRefused({
        kind: "unreadable",
        names: [item.name],
        total: 1,
        refs: [item.ref],
      });
    }
    return null;
  }

  private remember(
    item: Item,
    blob: Blob | null,
    hashed: Hashed,
    rows: ReadonlyMap<string, Hashed>,
    newRows: Map<string, Hashed>,
  ): void {
    if (item.bytes instanceof Blob) byBlob.set(item.bytes, hashed);
    if (blob) byBlob.set(blob, hashed);
    item.onHash?.(hashed);
    if (item.key && item.dims) {
      derived.set(item.key, {
        ...hashed,
        width: item.dims.width,
        height: item.dims.height,
        name: item.name,
      });
    }
    const row = item.cid ?? item.row;
    if (row && rows.get(row)?.hash !== hashed.hash) newRows.set(row, hashed);
  }
}

/** Send one item on an action's batch; the ref of its bytes on the server. */
export async function sendOne(
  batch: UploadBatch,
  bytes: Bytes,
  options: StageOptions,
): Promise<string> {
  const staged = batch.stage(bytes, options);
  const outcome = (await batch.run()).get(staged.ref);
  if (!outcome || isGone(outcome)) {
    throw new UploadRefused({ kind: "unreadable", names: [options.name], total: 1 });
  }
  return outcome.ref;
}
