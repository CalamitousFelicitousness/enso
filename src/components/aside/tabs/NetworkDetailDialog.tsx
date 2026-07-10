import { useMemo, useState } from "react";
import { Loader2, ExternalLink, ImageOff, ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useNetworkDetail } from "@/api/hooks/useNetworks";
import { useCivitVersionImages } from "@/api/hooks/useCivitai";
import { useModelProbe } from "@/api/hooks/useModelOps";
import { buildTrainingRows, hasTrainingMeta, topTrainingTags } from "@/lib/trainingMeta";
import { useGenerationStore } from "@/stores/generationStore";
import { civitaiModelUrl } from "@/lib/civitai";
import { insertAtCursor } from "@/lib/promptCursor";
import { sendPromptToGeneration, sendPromptToVideo } from "@/lib/sendTo";
import { toDisplayString } from "@/lib/utils";
import type { ExtraNetworkV2, NetworkDetail, PromptStyleV2 } from "@/api/types/models";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/api/client";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-xs leading-relaxed">
      <span className="text-muted-foreground shrink-0 w-18">{label}</span>
      <span className="font-medium break-words min-w-0">{value}</span>
    </div>
  );
}

function getCivitInfo(info: Record<string, unknown> | null | undefined) {
  if (!info || typeof info["id"] !== "number" || info["id"] <= 0) return null;
  const versions = Array.isArray(info["modelVersions"])
    ? (info["modelVersions"] as Array<Record<string, unknown>>)
    : [];
  const firstVersion = versions[0];
  const trainedWords = Array.isArray(firstVersion?.["trainedWords"])
    ? (firstVersion["trainedWords"] as string[]).filter(Boolean)
    : [];
  const baseModel =
    typeof firstVersion?.["baseModel"] === "string" ? firstVersion["baseModel"] : null;
  const versionId = typeof firstVersion?.["id"] === "number" ? firstVersion["id"] : null;
  return {
    id: info["id"],
    name: typeof info["name"] === "string" ? info["name"] : null,
    trainedWords,
    baseModel,
    versionId,
  };
}

const PARAM_DISPLAY_KEYS: [string, string][] = [
  ["steps", "Steps"],
  ["sampler", "Sampler"],
  ["cfgScale", "CFG"],
  ["seed", "Seed"],
  ["clipSkip", "Clip skip"],
  ["Size", "Size"],
];

function PreviewPromptSection({ versionId }: { versionId: number }) {
  // TODO: once sdnext's preview-embed PR ships, prefer reading the embedded
  // params from the local file via GET /sdapi/v1/png-info?file=<local_preview>
  // and fall back to this live fetch only when the chunk is absent.
  // See docs/civitai-preview-meta.md.
  const { data, isLoading, isError } = useCivitVersionImages([versionId], true);
  const meta = data?.[0]?.meta ?? null;

  const prompt = typeof meta?.["prompt"] === "string" ? meta["prompt"] : "";
  const negative = typeof meta?.["negativePrompt"] === "string" ? meta["negativePrompt"] : "";
  const hasPrompt = prompt.length > 0;

  const paramRows = useMemo(() => {
    if (!meta) return [] as Array<[string, string]>;
    const out: Array<[string, string]> = [];
    for (const [key, label] of PARAM_DISPLAY_KEYS) {
      const v = meta[key];
      if (v === undefined || v === null || v === "") continue;
      out.push([label, toDisplayString(v)]);
    }
    return out;
  }, [meta]);

  function handleSend(target: "generation" | "video") {
    if (!hasPrompt) return;
    const send = target === "generation" ? sendPromptToGeneration : sendPromptToVideo;
    send(prompt, negative || undefined);
    toast.success(target === "generation" ? "Prompt sent to Generation" : "Prompt sent to Video");
  }

  return (
    <div className="pt-2 border-t border-border space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Preview prompt</span>
        {hasPrompt && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-2xs text-primary hover:underline"
              >
                <Sparkles className="h-3 w-3" />
                Use
                <ChevronDown className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuLabel className="text-3xs">Send prompt</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => handleSend("generation")}>
                Generation
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSend("video")}>Video</DropdownMenuItem>
              {negative && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-3xs text-muted-foreground">
                    Includes negative prompt
                  </DropdownMenuLabel>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading from Civitai...
        </div>
      ) : isError ? (
        <p className="text-2xs text-muted-foreground/70 italic">Could not load preview metadata</p>
      ) : !hasPrompt ? (
        <p className="text-2xs text-muted-foreground/70 italic">
          Civitai didn&apos;t provide prompt metadata for this preview
        </p>
      ) : (
        <>
          <p className="text-2xs whitespace-pre-wrap break-words bg-muted/30 rounded p-2 max-h-32 overflow-y-auto font-mono">
            {prompt}
          </p>
          {negative && (
            <div className="space-y-1">
              <span className="text-3xs font-medium text-muted-foreground uppercase tracking-wider">
                Negative
              </span>
              <p className="text-2xs whitespace-pre-wrap break-words bg-muted/30 rounded p-2 max-h-24 overflow-y-auto font-mono">
                {negative}
              </p>
            </div>
          )}
          {paramRows.length > 0 && (
            <p className="text-2xs text-muted-foreground font-mono tabular-nums">
              {paramRows.map(([label, value]) => `${label} ${value}`).join("  ·  ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function HtmlDescription({ html }: { html: string }) {
  const [expanded, setExpanded] = useState(false);
  const isHtml = /<[a-z][\s\S]*>/i.test(html);

  if (isHtml) {
    return (
      <div className="space-y-1.5">
        <div
          className={`prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-img:my-2 ${!expanded ? "max-h-28 overflow-hidden" : ""}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />

        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-2xs text-primary hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      </div>
    );
  }

  const lines = html.split("\n");
  const isLong = lines.length > 6 || html.length > 400;
  return (
    <div className="space-y-1.5">
      <p
        className={`text-xs text-muted-foreground whitespace-pre-wrap ${!expanded && isLong ? "max-h-28 overflow-hidden" : ""}`}
      >
        {html}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-2xs text-primary hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function TriggerWords({ words }: { words: string[] }) {
  const [expanded, setExpanded] = useState(false);

  function handleClick(word: string) {
    const current = useGenerationStore.getState().prompt;
    useGenerationStore.getState().setParam("prompt", insertAtCursor(current, word));
    toast.success(`Added "${word}" to prompt`);
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs font-medium hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Trigger words ({words.length})
      </button>
      {expanded && (
        <div className="flex flex-wrap gap-1.5">
          {words.map((w, i) => (
            <button
              key={`${w}-${i}`}
              type="button"
              onClick={() => handleClick(w)}
              className="inline-flex items-center rounded-md border border-transparent bg-secondary text-secondary-foreground px-2 py-0.5 text-2xs font-medium cursor-pointer hover:bg-primary/20 select-none transition-colors"
            >
              {w}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NetworkDialogBody({
  detail,
  previewUrl,
}: {
  detail: NetworkDetail;
  previewUrl: string | null;
}) {
  const civit = getCivitInfo(detail.info);
  const tags = detail.tags?.replaceAll("|", ", ").split(", ").filter(Boolean) ?? [];
  const hasPreview = !!previewUrl;
  const { data: probe } = useModelProbe(detail.filename);
  const showTraining = Boolean(probe?.ok && hasTrainingMeta(probe.metadata));
  const trainTags = showTraining && probe ? topTrainingTags(probe.metadata, 20) : [];

  return (
    <div className={`flex gap-5 min-h-0 ${hasPreview ? "" : "flex-col"}`}>
      {/* Preview image */}
      {hasPreview && (
        <div className="shrink-0 w-56 flex items-start justify-center">
          <img
            src={previewUrl}
            alt={detail.name}
            className="max-h-80 w-full object-contain rounded-md bg-muted/20"
          />
        </div>
      )}

      {/* Metadata + description */}
      <ScrollArea className="flex-1 min-w-0 min-h-0 max-h-[calc(80vh-5rem)]">
        <div className="space-y-3 pr-3">
          {/* Metadata rows */}
          <div className="space-y-1">
            <DetailRow label="Type" value={detail.type} />
            <DetailRow label="Alias" value={detail.alias} />
            <DetailRow label="Hash" value={detail.hash} />
            <DetailRow label="Version" value={detail.version} />

            <DetailRow label="Size" value={detail.size != null ? formatBytes(detail.size) : null} />

            <DetailRow
              label="Modified"
              value={detail.mtime ? new Date(detail.mtime).toLocaleDateString() : null}
            />

            <DetailRow label="File" value={detail.filename?.split("/").pop()} />
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-border">
              <span className="text-xs font-medium">Tags</span>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t, i) => (
                  <button
                    key={`${t}-${i}`}
                    type="button"
                    onClick={() => {
                      const current = useGenerationStore.getState().prompt;
                      const tag = t.trim();
                      const updated = current ? `${current}, ${tag}` : tag;
                      useGenerationStore.getState().setParam("prompt", updated);
                      toast.success(`Added "${tag}" to prompt`);
                    }}
                    className="inline-flex items-center rounded-md border border-transparent bg-secondary text-secondary-foreground px-2 py-0.5 text-2xs font-medium cursor-pointer hover:bg-primary/20 select-none transition-colors"
                  >
                    {t.trim()}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* CivitAI trigger words */}
          {civit && civit.trainedWords.length > 0 && (
            <div className="pt-2 border-t border-border">
              <TriggerWords words={civit.trainedWords} />
            </div>
          )}

          {/* Embedded training metadata (kohya ss_*) read from the file header */}
          {showTraining && probe && (
            <div className="space-y-1.5 pt-2 border-t border-border">
              <span className="text-xs font-medium">Training metadata</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant="outline" className="text-3xs px-1.5 py-0.5">
                  {probe.arch.display}
                </Badge>
                {probe.dominant_dtype && (
                  <Badge variant="secondary" className="text-3xs px-1.5 py-0.5">
                    {probe.dominant_dtype}
                  </Badge>
                )}
                {probe.quant.scheme && (
                  <Badge variant="secondary" className="text-3xs px-1.5 py-0.5">
                    {probe.quant.scheme}
                  </Badge>
                )}
              </div>
              <div className="space-y-1">
                {buildTrainingRows(probe.metadata).map(([label, value]) => (
                  <DetailRow key={label} label={label} value={value} />
                ))}
              </div>
              {trainTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {trainTags.map(([tag, count]) => (
                    <button
                      key={tag}
                      type="button"
                      title={`${count} training images`}
                      onClick={() => {
                        const current = useGenerationStore.getState().prompt;
                        const updated = current ? `${current}, ${tag}` : tag;
                        useGenerationStore.getState().setParam("prompt", updated);
                        toast.success(`Added "${tag}" to prompt`);
                      }}
                      className="inline-flex items-center rounded-md border border-transparent bg-secondary text-secondary-foreground px-2 py-0.5 text-2xs font-medium cursor-pointer hover:bg-primary/20 select-none transition-colors"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* CivitAI preview prompt */}
          {civit?.versionId !== null && civit?.versionId !== undefined && (
            <PreviewPromptSection versionId={civit.versionId} />
          )}

          {/* CivitAI link */}
          {civit && (
            <div className="pt-2 border-t border-border space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">CivitAI</span>
                <a
                  href={civitaiModelUrl(civit.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              {civit.name && <DetailRow label="Name" value={civit.name} />}
              {civit.baseModel && <DetailRow label="Base" value={civit.baseModel} />}
            </div>
          )}

          {/* Description */}
          {detail.description && (
            <div className="pt-2 border-t border-border space-y-1.5">
              <span className="text-xs font-medium">Description</span>
              <HtmlDescription html={detail.description} />
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function StyleDialogBody({ item }: { item: PromptStyleV2 }) {
  const previewUrl = item.preview
    ? item.preview.startsWith("data:") || item.preview.startsWith("http")
      ? item.preview
      : `${api.getBaseUrl()}${item.preview}`
    : null;

  return (
    <div className={`flex gap-5 min-h-0 ${previewUrl ? "" : "flex-col"}`}>
      {previewUrl && (
        <div className="shrink-0 w-56 flex items-start justify-center">
          <img
            src={previewUrl}
            alt={item.name}
            className="max-h-80 w-full object-contain rounded-md bg-muted/20"
          />
        </div>
      )}
      <div className="flex-1 min-w-0 space-y-2">
        {item.prompt && (
          <div className="text-xs space-y-0.5">
            <span className="text-muted-foreground font-medium">Prompt</span>
            <p className="break-words bg-muted/30 rounded p-2 text-2xs">{item.prompt}</p>
          </div>
        )}
        {item.negative_prompt && (
          <div className="text-xs space-y-0.5">
            <span className="text-muted-foreground font-medium">Negative</span>
            <p className="break-words bg-muted/30 rounded p-2 text-2xs">{item.negative_prompt}</p>
          </div>
        )}
        {item.description && (
          <div className="pt-2 border-t border-border space-y-1.5">
            <span className="text-xs font-medium">Description</span>
            <HtmlDescription html={item.description} />
          </div>
        )}
        {item.filename && <DetailRow label="File" value={item.filename.split("/").pop()} />}
      </div>
    </div>
  );
}

export function NetworkDetailDialog({
  item,
  open,
  onOpenChange,
}: {
  item: ExtraNetworkV2 | PromptStyleV2 | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isNetwork = item && "type" in item && item.type;
  const network = isNetwork ? item : null;
  const { data: detail, isLoading } = useNetworkDetail(
    network?.type ?? "",
    item?.name ?? "",
    open && !!network,
  );

  const previewUrl = item?.preview
    ? item.preview.startsWith("data:") || item.preview.startsWith("http")
      ? item.preview
      : `${api.getBaseUrl()}${item.preview}`
    : null;

  const typeBadge = network ? network.version || network.type : "Style";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="sm:max-w-3xl max-h-[80vh] flex flex-col p-0 gap-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {!item && <DialogTitle className="sr-only">Network details</DialogTitle>}
        {item && (
          <>
            {/* Header - pr-10 reserves space for the absolute-positioned close button */}
            <div className="flex items-center gap-3 px-5 pr-10 py-3 border-b border-border/50 shrink-0">
              <DialogTitle className="text-sm font-semibold truncate flex-1 min-w-0">
                {item.name}
              </DialogTitle>
              <Badge variant="outline" className="text-2xs shrink-0">
                {typeBadge}
              </Badge>
              <DialogDescription className="sr-only">Details for {item.name}</DialogDescription>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-y-auto p-5">
              {!network ? (
                <StyleDialogBody item={item} />
              ) : isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading details...
                </div>
              ) : detail && detail.name ? (
                <NetworkDialogBody detail={detail} previewUrl={previewUrl} />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground py-8">
                  <ImageOff className="h-8 w-8 opacity-40" />
                  <p className="text-sm">No details available</p>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
