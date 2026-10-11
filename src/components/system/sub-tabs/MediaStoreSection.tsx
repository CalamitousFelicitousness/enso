// The media store: what it holds and by what, the disk it lives on, and a
// snapshot of its database and a verify of every file on demand. The media
// socket event keeps the report and the verify's progress current.

import { useState } from "react";
import { DatabaseBackup, Loader2, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { ApiError, api, refusalOf } from "@/api/client";
import { useMediaReport } from "@/api/hooks/useMedia";
import { queryClient } from "@/api/queryClient";
import { REPORT_KEY } from "@/api/queryKeys";
import type { ResMediaReportV2, ResSnapshotV2, VerifyStateV2 } from "@/api/types/media";
import { Button } from "@/components/ui/button";
import { useKeepAliveVisible } from "@/components/ui/keep-alive";
import { useMinute } from "@/hooks/useMinute";
import { failureText } from "@/inputs/quota";
import {
  CANCEL_VERIFY,
  cleanupText,
  diskText,
  filesText,
  LOADING,
  lastVerifyText,
  pendingRootText,
  previousRootText,
  REPORT_FAILED,
  RETRY,
  SNAPSHOT_FAILED,
  SNAPSHOT_SAVED,
  snapshotSavedText,
  snapshotsText,
  STORE_ROW_LABEL,
  storeOffText,
  TAKE_SNAPSHOT,
  TERM_LABELS,
  VERIFY_FAILED,
  VERIFY_FILES,
  verifyingText,
} from "@/lib/media/text";
import { cn, formatBytes } from "@/lib/utils";
import { Row, Section } from "../shared";

const TERMS = ["library", "records", "trash", "unnamed"] as const;

const reasonOf = (err: unknown) => refusalOf(err)?.message ?? failureText(err);
const size = (bytes: number) => formatBytes(bytes, 1);

function showVerify(verify: VerifyStateV2) {
  queryClient.setQueryData<ResMediaReportV2>(REPORT_KEY, (old) => (old ? { ...old, verify } : old));
}

async function takeSnapshot(): Promise<void> {
  try {
    const taken = await api.post<ResSnapshotV2>("/sdapi/v2/media/snapshot");
    toast.success(SNAPSHOT_SAVED, { description: snapshotSavedText(taken.path, taken.bytes) });
    void queryClient.invalidateQueries({ queryKey: REPORT_KEY });
  } catch (err) {
    toast.error(SNAPSHOT_FAILED, { description: reasonOf(err) });
  }
}

async function setVerify(start: boolean): Promise<void> {
  try {
    showVerify(
      start
        ? await api.post<VerifyStateV2>("/sdapi/v2/media/verify")
        : await api.delete<VerifyStateV2>("/sdapi/v2/media/verify"),
    );
  } catch (err) {
    // one started elsewhere is already in the report
    if (err instanceof ApiError && err.code === "verify_running") return;
    toast.error(VERIFY_FAILED, { description: reasonOf(err) });
  }
}

/** What one term keeps, with its share of the store as a bar. */
function TermRow({
  label,
  count,
  bytes,
  total,
}: {
  label: string;
  count: number;
  bytes: number;
  total: number;
}) {
  const share = total > 0 ? Math.min(100, (bytes / total) * 100) : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{`${label} (${count})`}</span>
        <span className="font-mono tabular-nums">{size(bytes)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300"
          style={{ width: `${share}%` }}
        />
      </div>
    </div>
  );
}

/** A count that is flagged once it is above zero. */
function CountRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-mono tabular-nums", value > 0 && "text-destructive")}>{value}</span>
    </div>
  );
}

export function MediaStoreSection() {
  const visible = useKeepAliveVisible();
  const { data: report, isError, isPending, refetch } = useMediaReport(visible);
  const now = useMinute(visible);
  const [snapshotting, setSnapshotting] = useState(false);

  if (isError && !report) {
    return (
      <Section title={STORE_ROW_LABEL}>
        <div className="flex items-center justify-between gap-2 text-xs text-destructive">
          {REPORT_FAILED}
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            {RETRY}
          </Button>
        </div>
      </Section>
    );
  }
  if (isPending) {
    return (
      <Section title={STORE_ROW_LABEL}>
        <p className="text-xs text-muted-foreground">{LOADING}</p>
      </Section>
    );
  }

  // the wire marks every field the server defaults as optional
  const { enabled, root = null, configured_root: configured = "" } = report;
  const verify = { running: false, checked: 0, total: 0, ...report.verify };
  const term = (held?: { count?: number; bytes?: number }) => ({
    count: 0,
    bytes: 0,
    ...held,
  });
  const running = enabled && verify.running;
  const pending = configured !== "" && configured !== root;
  const done = verify.total > 0 ? Math.min(100, (verify.checked / verify.total) * 100) : 0;
  const bytes = report.bytes ?? 0;

  return (
    <Section title={STORE_ROW_LABEL}>
      {enabled ? (
        <>
          <Row label="Folder" value={root} />
          <Row label="Disk" value={diskText(report.free ?? 0, report.total ?? 0)} />
          <Row label="Held" value={filesText(report.count ?? 0, bytes)} />
          {TERMS.map((name) => {
            const held = term(report.by_term?.[name]);
            return (
              <TermRow
                key={name}
                label={TERM_LABELS[name]}
                count={held.count}
                bytes={held.bytes}
                total={bytes}
              />
            );
          })}
          <CountRow label="Missing" value={report.lost ?? 0} />
          <CountRow label="Corrupt" value={term(report.corrupt).count} />
          <Row
            label="Snapshots"
            value={snapshotsText(term(report.snapshots).count, term(report.snapshots).bytes)}
          />
          <Row label="Last cleanup" value={cleanupText(report.last_gc, now)} />
        </>
      ) : (
        <p className="text-xs text-destructive">{storeOffText(report.reason ?? null)}</p>
      )}
      {pending && <p className="text-2xs text-muted-foreground">{pendingRootText(configured)}</p>}
      {report.previous_root && (
        <p className="text-2xs text-muted-foreground">{previousRootText(report.previous_root)}</p>
      )}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          disabled={!enabled || snapshotting}
          onClick={() => {
            setSnapshotting(true);
            void takeSnapshot().finally(() => setSnapshotting(false));
          }}
        >
          {snapshotting ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <DatabaseBackup className="h-3.5 w-3.5 mr-1" />
          )}
          {TAKE_SNAPSHOT}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!enabled}
          onClick={() => void setVerify(!running)}
        >
          {running ? (
            <X className="h-3.5 w-3.5 mr-1" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5 mr-1" />
          )}
          {running ? CANCEL_VERIFY : VERIFY_FILES}
        </Button>
      </div>
      <div className="flex h-4 items-center gap-2 text-2xs text-muted-foreground">
        <span className="truncate">
          {running
            ? verifyingText(verify.checked, verify.total)
            : enabled
              ? lastVerifyText(report.last_verify, now)
              : ""}
        </span>
        {running && verify.total > 0 && (
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{ width: `${done}%` }}
            />
          </div>
        )}
      </div>
    </Section>
  );
}
