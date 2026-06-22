import { useExtensions } from "@/api/hooks/useExtensions";
import { Badge } from "@/components/ui/badge";

// commit_date arrives as a stringified Unix epoch (seconds) from the backend;
// the version field is sdnext's Gradio-only HTML and is intentionally ignored.
function formatCommitDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const epoch = Number(raw);
  if (!Number.isFinite(epoch)) return null;
  const d = new Date(epoch * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

export function ExtensionsTab() {
  const { data: extensions, isLoading } = useExtensions();

  if (isLoading) {
    return <div className="p-3 text-xs text-muted-foreground">Loading extensions...</div>;
  }

  return (
    <div className="p-3 space-y-1">
      {extensions?.map((ext) => {
        const hash = ext.commit_hash?.slice(0, 8);
        const date = formatCommitDate(ext.commit_date);
        return (
          <div
            key={ext.name}
            className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50"
          >
            <span className="text-xs truncate min-w-0">{ext.name}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              {hash && <span className="font-mono text-3xs text-muted-foreground">{hash}</span>}
              {date && <span className="text-3xs text-muted-foreground">{date}</span>}
              <Badge
                variant={ext.enabled ? "default" : "secondary"}
                className="text-3xs px-1.5 py-0"
              >
                {ext.enabled ? "on" : "off"}
              </Badge>
            </div>
          </div>
        );
      })}
      {(!extensions || extensions.length === 0) && (
        <p className="text-xs text-muted-foreground">No extensions found.</p>
      )}
    </div>
  );
}
