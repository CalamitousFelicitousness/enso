// The media store as this browser follows it: the trash's retention copied
// where the page-start sweep reads it without asking the server, a notice
// when the server's would let this browser's removed inputs go early, a
// standing notice while the server keeps no uploads, and the offer to move
// what older builds kept here.

import { useEffect } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useMediaSettings } from "@/api/hooks/useMedia";
import { useServerInfo } from "@/api/hooks/useServer";
import { queryClient } from "@/api/queryClient";
import { SETTINGS_KEY } from "@/api/queryKeys";
import type { ResMediaSettingsV2 } from "@/api/types/media";
import { shortensRetention } from "@/lib/media/settings";
import {
  OLDER_SERVER,
  OLDER_SERVER_DETAIL,
  retentionNoticeText,
  SETTING_FAILED,
  STORE_OFF_DETAIL,
  storeOffText,
} from "@/lib/media/text";
import { inputsReady } from "@/stores/inputStore";
import { readTrashDays, writeTrashDays } from "./db";
import { failureText } from "./quota";
import { offerMove } from "./migrate";
import { useTrash } from "./trash";

const RETENTION_TOAST = "trash-days";
const STORE_TOAST = "media-store";

/** The move of what older builds kept here was offered on this page. */
let offered = false;

/** The shorter retention was asked about on this page. */
let asked = false;

async function keep(days: number): Promise<void> {
  try {
    await writeTrashDays(days);
    useTrash.setState({ days });
  } catch (err) {
    console.warn("[inputs] could not keep the trash's retention", err);
  }
}

async function keepOnServer(days: number): Promise<void> {
  try {
    const answer = await api.patch<ResMediaSettingsV2>("/sdapi/v2/media/settings", {
      trash_days: days,
    });
    queryClient.setQueryData(SETTINGS_KEY, answer);
  } catch (err) {
    toast.error(SETTING_FAILED, { description: failureText(err) });
  }
}

/** The retention chosen in this page's own row: the browser's copy takes it
 * before the server answers, so the answer is not asked about as another
 * browser's change. Answers the revert for a write the server refuses. */
export async function chooseRetention(days: number): Promise<() => Promise<void>> {
  const before = await readTrashDays().catch(() => null);
  await keep(days);
  return () => (before === null ? Promise.resolve() : keep(before));
}

/** Follow the server's retention; one that would let this browser's removed
 * inputs go early is asked about first, and until then the copy keeps the
 * browser's own. */
async function follow(serverDays: number): Promise<void> {
  const local = await readTrashDays().catch(() => null);
  if (local === null || !shortensRetention(serverDays, local)) {
    // a notice about an earlier answer no longer applies
    toast.dismiss(RETENTION_TOAST);
    asked = false;
    await keep(serverDays);
    return;
  }
  if (asked) return;
  asked = true;
  const text = retentionNoticeText(serverDays, local);
  toast(text.title, {
    id: RETENTION_TOAST,
    duration: Infinity,
    description: text.description,
    action: { label: text.keep, onClick: () => void keepOnServer(local) },
    cancel: { label: text.use, onClick: () => void keep(serverDays) },
  });
}

/** Keep the media store's settings and state followed for the page's life. */
export function useMediaSync(): void {
  const days = useMediaSettings().data?.trash_days;
  useEffect(() => {
    if (days !== undefined) void follow(days);
  }, [days]);

  const info = useServerInfo().data;
  // undefined until the server answers; null on a server without a media store
  const store = info ? (info.media_store ?? null) : undefined;
  const off =
    store === undefined ? null : store === null ? "older" : store.enabled === false ? "off" : "on";
  const reason = store?.reason ?? null;
  useEffect(() => {
    if (off === null) return;
    if (off === "on") {
      toast.dismiss(STORE_TOAST);
      return;
    }
    toast.warning(off === "older" ? OLDER_SERVER : storeOffText(reason), {
      id: STORE_TOAST,
      duration: Infinity,
      description: off === "older" ? OLDER_SERVER_DETAIL : STORE_OFF_DETAIL,
    });
  }, [off, reason]);

  // what older builds kept here is offered once the store is known to be on
  useEffect(() => {
    if (off !== "on" || offered) return;
    offered = true;
    void inputsReady().then(offerMove);
  }, [off]);
}
