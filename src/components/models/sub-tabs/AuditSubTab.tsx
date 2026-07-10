import { useState } from "react";
import { Loader2, ScanSearch } from "lucide-react";
import { useModelAudit } from "@/api/hooks/useModelOps";
import type { ModelAuditFile } from "@/api/types/modelOps";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

function formatSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  return `${(bytes / 1_048_576).toFixed(0)} MB`;
}

function hasIssues(f: ModelAuditFile): boolean {
  return f.mismatches.length > 0 || f.error !== null;
}

function precisionLabel(f: ModelAuditFile): string {
  if (f.quant.scheme === "comfy_quant") {
    return f.quant.format === "int8_tensorwise" ? "comfy int8" : "comfy fp8";
  }
  if (f.quant.scheme === "gguf") return f.quant.format ?? "gguf";
  if (f.quant.scheme === "scaled_fp8") return "scaled fp8";
  return f.dominant_dtype ?? "-";
}

export function AuditSubTab() {
  const audit = useModelAudit();
  const [issuesOnly, setIssuesOnly] = useState(true);
  const data = audit.data;
  const files = data?.files ?? [];
  const shown = issuesOnly ? files.filter(hasIssues) : files;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Button size="sm" onClick={() => audit.mutate({})} disabled={audit.isPending}>
          {audit.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ScanSearch className="h-3.5 w-3.5" />
          )}
          Scan library
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => audit.mutate({ force: true })}
          disabled={audit.isPending}
        >
          Force rescan
        </Button>
        <div className="flex items-center gap-2">
          <Switch id="audit-issues-only" checked={issuesOnly} onCheckedChange={setIssuesOnly} />
          <Label htmlFor="audit-issues-only">Issues only</Label>
        </div>
      </div>

      {data && (
        <>
          <div className="flex items-center gap-2 flex-wrap text-2xs text-muted-foreground">
            <span className="font-mono tabular-nums">
              {data.scanned} files in {data.elapsed}s ({data.from_cache} cached)
            </span>
            <Badge variant="outline" className="text-3xs px-1.5 py-0.5">
              {data.summary.mismatch_count} mismatches
            </Badge>
            {data.summary.corrupt_count > 0 && (
              <Badge
                variant="outline"
                className="text-3xs px-1.5 py-0.5 border-red-500/40 text-red-400"
              >
                {data.summary.corrupt_count} unreadable
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {Object.entries(data.summary.by_family)
              .sort((a, b) => b[1] - a[1])
              .map(([family, count]) => (
                <Badge key={family} variant="secondary" className="text-3xs px-1.5 py-0.5">
                  {family}: {count}
                </Badge>
              ))}
          </div>

          {shown.length > 0 ? (
            <div className="border border-border rounded-md overflow-x-auto">
              <table className="w-full text-2xs">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="px-2 py-1 text-left font-medium">File</th>
                    <th className="px-2 py-1 text-left font-medium">Root</th>
                    <th className="px-2 py-1 text-left font-medium">Kind</th>
                    <th className="px-2 py-1 text-left font-medium">Arch</th>
                    <th className="px-2 py-1 text-left font-medium">Precision</th>
                    <th className="px-2 py-1 text-right font-medium">Size</th>
                    <th className="px-2 py-1 text-left font-medium">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((f) => (
                    <tr key={f.path} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="px-2 py-1 truncate max-w-[11rem] font-mono" title={f.path}>
                        {f.path.split("/").pop()}
                      </td>
                      <td className="px-2 py-1">{f.root}</td>
                      <td className="px-2 py-1">{f.kind}</td>
                      <td className="px-2 py-1 truncate max-w-[8rem]" title={f.family}>
                        {f.display}
                        {f.variant ? ` (${f.variant})` : ""}
                        {f.confidence > 0 && f.confidence < 0.9 ? " ?" : ""}
                      </td>
                      <td className="px-2 py-1 font-mono">{precisionLabel(f)}</td>
                      <td className="px-2 py-1 text-right font-mono">{formatSize(f.size)}</td>
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-1 flex-wrap">
                          {f.error && (
                            <Badge
                              variant="outline"
                              className="text-3xs px-1 py-0 border-red-500/40 text-red-400"
                              title={f.error}
                            >
                              unreadable
                            </Badge>
                          )}
                          {f.mismatches.map((m) => (
                            <Badge
                              key={m.kind}
                              variant="outline"
                              className="text-3xs px-1 py-0 border-amber-500/40 text-amber-500"
                              title={m.kind}
                            >
                              {m.claimed} &rarr; {m.actual}
                            </Badge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {issuesOnly ? "No issues found." : "No files scanned."}
            </p>
          )}
        </>
      )}

      {!data && !audit.isPending && (
        <p className="text-xs text-muted-foreground">
          Header-only scan of all model folders: verifies real architecture, precision, and
          quantization against what folders and filenames claim. Safe to run any time; repeat scans
          are cached.
        </p>
      )}
      {audit.error && <p className="text-xs text-red-400">{String(audit.error)}</p>}
    </div>
  );
}
