// The settings the server keeps for every browser: how long the trash keeps
// what goes to it, how many saved entries and job records stay, and where
// the store is. A raise is written at once; a reduction that lets something
// go is asked first with the counts, since it deletes for every browser.

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ApiError, api } from "@/api/client";
import { useLibrary, useMediaReport, useMediaSettings, useServerTrash } from "@/api/hooks/useMedia";
import { useServerInfo } from "@/api/hooks/useServer";
import { queryClient } from "@/api/queryClient";
import { SETTINGS_KEY, storeOffIn } from "@/api/queryKeys";
import type { ResMediaSettingsV2 } from "@/api/types/media";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";
import { useMinute } from "@/hooks/useMinute";
import { useMyRecords } from "@/hooks/useMyRecords";
import { failureText } from "@/inputs/quota";
import { useTrash } from "@/inputs/trash";
import { sweepPolicy } from "@/lib/inputs/sweep";
import { TRASH_DAYS_LABEL, trashDaysValue } from "@/lib/inputs/text";
import { goingOnServer, goingWith } from "@/lib/inputs/trash";
import { isTerminal } from "@/lib/jobs/domains";
import {
  commitKind,
  retirable,
  type ReductionCounts,
  type SharedSetting,
} from "@/lib/media/settings";
import {
  LIBRARY_CAP_LABEL,
  libraryCapText,
  LOADING,
  RECORD_CAP_LABEL,
  recordCapText,
  reductionText,
  SETTING_FAILED,
  SETTINGS_FROZEN,
  STORE_ROW_LABEL,
  storeOffText,
  storeRowText,
  trashDaysBothText,
} from "@/lib/media/text";
import { useJobQueueStore } from "@/stores/jobStore";
import { CommittedSliderRow, SettingRow } from "./SettingRow";

/** Write one setting. The cache takes only the server's answer, which the
 * page's local retention follows; the row shows the value in flight. */
async function writeSetting(setting: SharedSetting, value: number): Promise<void> {
  try {
    const answer = await api.patch<ResMediaSettingsV2>("/sdapi/v2/media/settings", {
      [setting]: value,
    });
    queryClient.setQueryData(SETTINGS_KEY, answer);
  } catch (err) {
    const frozen = err instanceof ApiError && err.code === "settings_frozen";
    toast.error(SETTING_FAILED, {
      description: frozen ? SETTINGS_FROZEN : failureText(err),
    });
  }
}

interface Pending {
  setting: SharedSetting;
  value: number;
  counts: ReductionCounts;
}

const FORMAT: Record<SharedSetting, (value: number) => string> = {
  trash_days: trashDaysValue,
  library_cap: String,
  record_cap: String,
};

const LABEL: Record<SharedSetting, string> = {
  trash_days: TRASH_DAYS_LABEL,
  library_cap: LIBRARY_CAP_LABEL,
  record_cap: RECORD_CAP_LABEL,
};

const NO_VALUE = () => "";

export function MediaSettingsRows() {
  const visible = useKeepAliveVisible();
  const settings = useMediaSettings(visible);
  const library = useLibrary(visible);
  const trash = useServerTrash(visible);
  const records = useMyRecords(visible);
  const report = useMediaReport(visible);
  const info = useServerInfo().data;
  const removals = useTrash((s) => s.removals);
  const jobs = useJobQueueStore((s) => s.jobs);
  const now = useMinute(visible);
  // one pending reduction: a later commit takes its place
  const [pending, setPending] = useState<Pending | null>(null);
  // values sent and not yet answered, shown in their rows
  const [sending, setSending] = useState<ReadonlyMap<SharedSetting, number>>(
    () => new Map<SharedSetting, number>(),
  );
  const send = (setting: SharedSetting, value: number) => {
    setSending((m) => new Map(m).set(setting, value));
    void writeSetting(setting, value).finally(() =>
      setSending((m) => {
        if (m.get(setting) !== value) return m;
        const next = new Map(m);
        next.delete(setting);
        return next;
      }),
    );
  };

  const off = storeOffIn(settings.error);
  const data = off === null ? settings.data : undefined;
  const live = useMemo(
    () => new Set([...jobs.values()].filter((j) => !isTerminal(j.status)).map((j) => j.id)),
    [jobs],
  );

  const counts = (setting: SharedSetting, value: number): ReductionCounts => {
    switch (setting) {
      case "trash_days":
        return {
          here: goingWith(
            [...removals.values()].map((r) => ({ removedAt: r.removedAt })),
            sweepPolicy(value).removalMs,
            now,
          ),
          server: goingOnServer(
            (trash.data?.entries ?? []).flatMap((e) =>
              e.trashed_at == null ? [] : [e.trashed_at],
            ),
            value,
            now,
          ),
        };
      case "library_cap": {
        const unpinned = (library.data?.entries ?? []).filter((e) => !e.pinned).length;
        return { here: 0, server: Math.max(0, unpinned - value) };
      }
      case "record_cap":
        return { here: retirable(records.data ?? [], value, live, now), server: 0 };
    }
  };

  const describe = (setting: SharedSetting, shown: number): string => {
    if (off !== null) return storeOffText(off || null);
    if (!data) return LOADING;
    const lower = shown < (sending.get(setting) ?? data[setting]);
    const c = counts(setting, shown);
    switch (setting) {
      case "trash_days":
        return lower ? trashDaysBothText(c.here, c.server) : trashDaysBothText(0, 0);
      case "library_cap":
        return libraryCapText(lower ? c.server : 0);
      case "record_cap":
        return recordCapText(lower ? c.here : 0);
    }
  };

  const commit = (setting: SharedSetting, value: number) => {
    if (!data) return;
    const c = counts(setting, value);
    const kind = commitKind(setting, sending.get(setting) ?? data[setting], value, c);
    if (kind === "write") send(setting, value);
    else if (kind === "confirm") setPending({ setting, value, counts: c });
  };

  const row = (setting: SharedSetting) => {
    const bound = data?.bounds[setting];
    const value = sending.get(setting) ?? data?.[setting] ?? 0;
    return (
      <CommittedSliderRow
        key={setting}
        label={LABEL[setting]}
        value={value}
        min={bound?.low ?? value}
        max={bound?.high ?? value}
        format={data ? FORMAT[setting] : NO_VALUE}
        describe={(shown) => describe(setting, shown)}
        onCommit={(v) => commit(setting, v)}
        disabled={!data}
      />
    );
  };

  const store = info?.media_store;
  const where = !info
    ? LOADING
    : storeRowText(
        {
          enabled: store?.enabled ?? false,
          reason: store?.reason ?? null,
          root: store?.root ?? null,
        },
        report.data?.free ?? null,
        report.data?.configured_root ?? null,
      );
  const asked = pending ? reductionText(pending.setting, pending.value, pending.counts) : null;

  return (
    <>
      {row("trash_days")}
      {row("library_cap")}
      {row("record_cap")}
      <SettingRow label={STORE_ROW_LABEL} description={where}>
        {null}
      </SettingRow>
      <ConfirmDialog
        open={asked !== null}
        title={asked?.title ?? ""}
        description={asked?.description ?? ""}
        confirmLabel="Change"
        destructive
        onConfirm={() => {
          if (pending) send(pending.setting, pending.value);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
