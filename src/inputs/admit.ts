// The door every picture passes before anything decodes it: its header read
// from the first bytes, held to this browser's decoders and the limits of the
// browser and the server, and refused with one toast per reason.

import { useMemo } from "react";
import { toast } from "sonner";
import { useMediaSettings } from "@/api/hooks/useMedia";
import { serverInfoQuery, useServerInfo } from "@/api/hooks/useServer";
import { queryClient } from "@/api/queryClient";
import { SETTINGS_KEY } from "@/api/queryKeys";
import type { ResMediaSettingsV2 } from "@/api/types/media";
import type { ServerInfo } from "@/api/types/server";
import { imageHeader, KIND_NAMES, type ImageKind, type PixelSize } from "@/lib/media/dimensions";
import {
  admission,
  effectiveLimit,
  refusalKey,
  tooLarge,
  type Admission,
  type Destination,
  type EffectiveLimit,
  type MediaLimits,
  type Refusal,
} from "@/lib/media/limits";
import { refusalText } from "@/lib/media/text";
import { browserMedia } from "./probe";

/** The server's input limit as this page last heard it: the settings when
 * read, else server-info, else null before the server answered. */
export function serverLimit(): number | null {
  const settings = queryClient.getQueryData<ResMediaSettingsV2>(SETTINGS_KEY);
  if (settings) return settings.max_input_pixels;
  return (
    queryClient.getQueryData<ServerInfo>(serverInfoQuery.queryKey)?.limits?.input_pixels ?? null
  );
}

/** The effective limit, following the settings and server-info as they change. */
export function useEffectiveLimit(): EffectiveLimit {
  const settings = useMediaSettings(false).data;
  const info = useServerInfo().data;
  const server = settings?.max_input_pixels ?? info?.limits?.input_pixels ?? null;
  return useMemo(() => effectiveLimit(server), [server]);
}

function serverKinds(): ReadonlySet<ImageKind> | null {
  const formats = queryClient.getQueryData<ServerInfo>(serverInfoQuery.queryKey)?.limits?.formats;
  if (!formats) return null;
  return new Set(formats.filter((kind): kind is ImageKind => kind in KIND_NAMES));
}

export async function mediaLimits(): Promise<MediaLimits> {
  const browser = await browserMedia();
  return {
    server: serverLimit(),
    serverKinds: serverKinds(),
    browserKinds: browser.kinds,
    ignoresOrientation: browser.ignoresOrientation,
  };
}

/** Bytes of a file from `offset`, fewer at its end. */
const reader = (file: Blob) => async (offset: number, length: number) =>
  new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());

/** Whether `file` may enter `where`, from its first bytes. */
export async function admit(file: Blob, where: Destination): Promise<Admission> {
  const [header, limits] = await Promise.all([imageHeader(reader(file)), mediaLimits()]);
  return admission(file.type, header, limits, where);
}

/** A file's size as this browser draws it, from its header; null when the header does not give it. */
export async function headerSize(file: Blob): Promise<PixelSize | null> {
  const [header, browser] = await Promise.all([imageHeader(reader(file)), browserMedia()]);
  if (header.kind === "unknown" || header.size === null) return null;
  return browser.ignoresOrientation.has(header.kind) ? header.size : header.oriented;
}

/** A decoded size over the limit, which a header that lied lets through. */
export function decodedTooLarge(size: PixelSize): Refusal | null {
  return tooLarge(size, serverLimit());
}

export interface Refused {
  name: string;
  refusal: Refusal;
}

/** One toast per reason for the files of one drop. */
export function announceRefusals(refused: readonly Refused[]): void {
  const groups = new Map<string, Refused[]>();
  for (const item of refused) {
    const key = refusalKey(item.refusal);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const group of groups.values()) {
    const { title, description } = refusalText(
      group[0].refusal,
      group.map((item) => item.name),
    );
    toast.error(title, { description });
  }
}
