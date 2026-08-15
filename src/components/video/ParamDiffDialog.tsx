import { useMemo, useCallback } from "react";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { toDisplayString } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useVideoStore } from "@/stores/videoStore";
import { WIRE_TO_STORE, VIDEO_PARAM_KEYS, type VideoJobType } from "@/lib/video/paramRegistry";
import type { VideoWireParams } from "@/api/types/wireParams";

interface ParamDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resultParams: VideoWireParams;
  domain: VideoJobType;
}

function normalizeResultParams(
  raw: VideoWireParams,
  domain: VideoJobType,
): Record<string, unknown> {
  const map = WIRE_TO_STORE[domain];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const storeKey = map[k];
    if (storeKey) out[storeKey] = v;
  }
  return out;
}

function formatValue(v: unknown): string {
  if (v === undefined || v === null) return "-";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") return v || '""';
  return toDisplayString(v);
}

interface DiffRow {
  key: string;
  current: unknown;
  result: unknown;
  changed: boolean;
}

export function ParamDiffDialog({
  open,
  onOpenChange,
  resultParams,
  domain,
}: ParamDiffDialogProps) {
  const storeState = useVideoStore();
  const setParams = useVideoStore((s) => s.setParams);

  const normalized = useMemo(
    () => normalizeResultParams(resultParams, domain),
    [resultParams, domain],
  );

  const rows = useMemo<DiffRow[]>(() => {
    return VIDEO_PARAM_KEYS.filter((k) => k in normalized).map((k) => {
      const current = (storeState as unknown as Record<string, unknown>)[k];
      const result = normalized[k];
      return {
        key: k,
        current,
        result,
        changed: JSON.stringify(current) !== JSON.stringify(result),
      };
    });
  }, [storeState, normalized]);

  const changedCount = rows.filter((r) => r.changed).length;

  const handleApplyAll = useCallback(() => {
    const updates: Record<string, unknown> = {};
    for (const row of rows) {
      if (row.changed) updates[row.key] = row.result;
    }
    setParams(updates);
    toast.success(`Applied ${changedCount} changed parameter${changedCount !== 1 ? "s" : ""}`);
    onOpenChange(false);
  }, [rows, changedCount, setParams, onOpenChange]);

  const handleApplyOne = useCallback(
    (key: string, value: unknown) => {
      setParams({ [key]: value });
      toast.success(`Applied ${key}`);
    },
    [setParams],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Compare Settings ({changedCount} changed)</DialogTitle>
          <DialogDescription className="sr-only">
            Side-by-side comparison of video parameters
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <table className="w-full text-2xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1 px-2 font-medium">Parameter</th>
                <th className="py-1 px-2 font-medium">Current</th>
                <th className="py-1 px-2 font-medium">Result</th>
                <th className="py-1 px-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className={row.changed ? "bg-amber-500/10" : "text-muted-foreground/60"}
                >
                  <td className="py-0.5 px-2 font-mono">{row.key}</td>
                  <td className="py-0.5 px-2 max-w-32 truncate">{formatValue(row.current)}</td>
                  <td className="py-0.5 px-2 max-w-32 truncate font-medium">
                    {formatValue(row.result)}
                  </td>
                  <td className="py-0.5 px-1">
                    {row.changed && (
                      <button
                        type="button"
                        onClick={() => handleApplyOne(row.key, row.result)}
                        className="hover:text-primary"
                        title="Apply this value"
                      >
                        <ArrowRight size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={handleApplyAll} disabled={changedCount === 0}>
            Apply All ({changedCount})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
