// Small pictures for lists and cards: one thumbnail per cid, stored beside
// the picture's bytes under `<cid>/thumb@320` so a later page reads it back
// instead of decoding the picture again, and deleted by the sweep with them.

import { useEffect, useState } from "react";
import { thumbSize } from "@/lib/inputs/geometry";
import type { Size } from "@/lib/inputs/types";
import { putBlob, readBlob } from "./db";
import { decodedImage, useBlobUrl } from "./media";

/** The shorter side of a thumbnail, enough for a card at twice the pixel density. */
const SIDE = 320;
/** Thumbnails made at once; each decodes a whole picture. */
const AT_ONCE = 2;
/** Thumbnails nothing shows that stay in memory. */
const IDLE_KEPT = 200;

/** A picture to show small: its cid and natural size, and its bytes when the
 * caller holds them (otherwise they are read by cid). */
export interface ThumbSource extends Size {
  cid: string;
  file: Blob | null;
}

const thumbKey = (cid: string) => `${cid}/thumb@${SIDE}`;

let running = 0;
const queue: (() => void)[] = [];

async function inTurn<T>(task: () => Promise<T>): Promise<T> {
  if (running >= AT_ONCE) await new Promise<void>((resolve) => queue.push(resolve));
  running += 1;
  try {
    return await task();
  } finally {
    running -= 1;
    queue.shift()?.();
  }
}

async function render(picture: Blob, natural: Size): Promise<Blob> {
  const { width, height } = thumbSize(natural, SIDE);
  const bitmap = await createImageBitmap(decodedImage(picture) ?? picture, {
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: "high",
  });
  try {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context for a thumbnail");
    context.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
  } finally {
    bitmap.close();
  }
}

/** Cids whose thumbnail could not be stored on this page, such as when
 * storage is full; they are made again in memory, not stored again. */
const unstorable = new Set<string>();

async function make(source: ThumbSource): Promise<Blob> {
  const stored = await readBlob(thumbKey(source.cid)).catch(() => null);
  if (stored) return stored;
  const picture = source.file ?? (await readBlob(source.cid));
  if (!picture) throw new Error("the picture's bytes are gone");
  const thumb = await inTurn(() => render(picture, source));
  if (!unstorable.has(source.cid)) {
    putBlob(thumbKey(source.cid), thumb).catch((err: unknown) => {
      unstorable.add(source.cid);
      console.warn("[inputs] could not store a thumbnail", err);
    });
  }
  return thumb;
}

interface Slot {
  thumb: Promise<Blob>;
  users: number;
}

/** By cid, least recently asked for first. */
const slots = new Map<string, Slot>();

function acquire(source: ThumbSource): Slot {
  let slot = slots.get(source.cid);
  if (slot) slots.delete(source.cid);
  else slot = { thumb: make(source), users: 0 };
  slots.set(source.cid, slot);
  slot.users += 1;
  return slot;
}

function release(cid: string): void {
  const slot = slots.get(cid);
  if (!slot) return;
  slot.users -= 1;
  const idle = [...slots].filter(([, s]) => s.users === 0);
  for (const [key] of idle.slice(0, Math.max(0, idle.length - IDLE_KEPT))) slots.delete(key);
}

/** Let go of the thumbnails of deleted pictures: the browser keeps a deleted
 * blob's file on disk while a handle read from it is alive. */
export function forgetThumbs(cids: Iterable<string>): void {
  for (const cid of cids) slots.delete(cid);
}

/** The picture's thumbnail, read back or made and stored. */
export function thumbBlob(source: ThumbSource): Promise<Blob> {
  const { thumb } = acquire(source);
  release(source.cid);
  return thumb;
}

/** A URL for the picture's thumbnail once it is ready; null before then,
 * while `active` is false, and for a picture whose bytes are gone. */
export function useThumb(source: ThumbSource | null, active = true): string | null {
  const [thumb, setThumb] = useState<{ cid: string; blob: Blob } | null>(null);
  const cid = source?.cid ?? null;
  const file = source?.file ?? null;
  const width = source?.width ?? 0;
  const height = source?.height ?? 0;
  useEffect(() => {
    if (cid === null || !active) return;
    let current = true;
    acquire({ cid, file, width, height }).thumb.then(
      (blob) => {
        if (current) setThumb({ cid, blob });
      },
      () => {},
    );
    return () => {
      current = false;
      release(cid);
    };
  }, [cid, file, width, height, active]);
  return useBlobUrl(thumb && thumb.cid === cid ? thumb.blob : null);
}
