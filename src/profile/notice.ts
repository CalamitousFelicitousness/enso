// What the page says after a reset, or when another tab is resetting.

import { useEffect } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { LOCAL } from "@/lib/profile/names";
import { readResetRecord } from "@/lib/profile/record";
import {
  doneText,
  FROZEN_TEXT,
  FROZEN_TITLE,
  POSTPONED,
  POSTPONED_TEXT,
  RELOAD,
  RESET_DONE,
} from "@/lib/profile/text";
import { onFrozen } from "./freeze";
import { readLocal, removeLocal } from "./local";

const DONE_MS = 10_000;

/** The notice after a reset is on screen; the tutorial waits for it. */
export const useResetNoticeShowing = create<{ showing: boolean }>()(() => ({ showing: false }));

let taken = false;

function showDone(): void {
  if (taken) return;
  taken = true;
  const record = readResetRecord(readLocal(LOCAL.reset));
  if (record?.state !== "done") return;
  removeLocal(LOCAL.reset);
  const hidden = () => useResetNoticeShowing.setState({ showing: false });
  useResetNoticeShowing.setState({ showing: true });
  if (record.postponed) {
    toast.warning(POSTPONED, {
      description: POSTPONED_TEXT,
      duration: Infinity,
      onDismiss: hidden,
      onAutoClose: hidden,
    });
    return;
  }
  const show = record.notes.length > 0 ? toast.warning : toast.success;
  show(RESET_DONE, {
    description: doneText(record.rows, record.notes),
    duration: record.notes.length > 0 ? Infinity : DONE_MS,
    onDismiss: hidden,
    onAutoClose: hidden,
  });
}

/** Tells the outcome of the reset the boot module carried out, once, and
 * says so when another tab starts one. */
export function useResetNotice(): void {
  useEffect(showDone, []);
  useEffect(
    () =>
      onFrozen(() =>
        toast.warning(FROZEN_TITLE, {
          id: "profile-frozen",
          description: FROZEN_TEXT,
          duration: Infinity,
          action: { label: RELOAD, onClick: () => window.location.reload() },
        }),
      ),
    [],
  );
}
