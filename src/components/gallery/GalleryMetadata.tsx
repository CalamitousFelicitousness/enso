import { useMemo, useState } from "react";
import { useGalleryStore } from "@/stores/galleryStore";
import { useGenerationStore } from "@/stores/generationStore";
import { parseGenerationInfo } from "@/lib/parseGenerationInfo";
import {
  sendImageToCanvas,
  sendPromptToGeneration,
  fetchRemoteImage,
} from "@/lib/sendTo";
import { isVideoFile } from "@/lib/mediaType";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { SectionLeader } from "@/components/ui/section-leader";
import { Button } from "@/components/ui/button";
import {
  Copy,
  Download,
  ExternalLink,
  ImageIcon,
  Check,
  Paintbrush,
  Wand2,
} from "lucide-react";

interface VideoMeta {
  codec: string;
  frames: string;
  duration: string;
  fps: string;
}

function parseVideoExif(exif: string): VideoMeta | null {
  if (!exif) return null;
  const result: VideoMeta = { codec: "", frames: "", duration: "", fps: "" };
  let matched = false;
  for (const part of exif.split(",")) {
    const trimmed = part.trim();
    const [key, ...rest] = trimmed.split(":");
    const val = rest.join(":").trim();
    const k = key.trim().toLowerCase();
    if (k === "codec") {
      result.codec = val;
      matched = true;
    } else if (k === "frames") {
      result.frames = val;
      matched = true;
    } else if (k === "duration") {
      result.duration = val;
      matched = true;
    } else if (k === "fps") {
      result.fps = val;
      matched = true;
    }
  }
  return matched ? result : null;
}

const PARAM_TO_STORE_KEY: Record<string, string> = {
  Steps: "steps",
  Sampler: "sampler",
  "CFG scale": "cfgScale",
  "CFG Scale": "cfgScale",
  Seed: "seed",
  "Size-1": "width",
  "Size-2": "height",
};

export function GalleryMetadata() {
  const selectedFile = useGalleryStore((s) => s.selectedFile);
  const selectedThumb = useGalleryStore((s) => s.selectedThumb);

  const isVideo = selectedFile ? isVideoFile(selectedFile.relativePath) : false;

  const genInfo = useMemo(() => {
    return parseGenerationInfo(selectedThumb?.exif);
  }, [selectedThumb]);

  const videoMeta = useMemo(() => {
    if (!isVideo || !selectedThumb?.exif) return null;
    return parseVideoExif(selectedThumb.exif);
  }, [isVideo, selectedThumb]);

  if (!selectedFile || !selectedThumb) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs p-3">
        <ImageIcon size={20} className="opacity-30 mb-2" />
        <p>Select an image to view details</p>
      </div>
    );
  }

  const filename =
    selectedFile.relativePath.split("/").pop() ?? selectedFile.relativePath;
  const fullUrl = `/file=${selectedFile.fullPath}`;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (ms: number) => {
    return new Date(ms).toLocaleString();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const copyPromptToGeneration = () => {
    if (genInfo.prompt) {
      useGenerationStore.getState().setParam("prompt", genInfo.prompt);
    }
  };

  const copyNegativeToGeneration = () => {
    if (genInfo.negativePrompt) {
      useGenerationStore
        .getState()
        .setParam("negativePrompt", genInfo.negativePrompt);
    }
  };

  const useAllSettings = () => {
    const gen = useGenerationStore.getState();
    if (genInfo.prompt) gen.setParam("prompt", genInfo.prompt);
    if (genInfo.negativePrompt)
      gen.setParam("negativePrompt", genInfo.negativePrompt);
    const updates: Record<string, unknown> = {};
    for (const [paramKey, storeKey] of Object.entries(PARAM_TO_STORE_KEY)) {
      const val = genInfo.params[paramKey];
      if (val !== undefined) {
        const num = Number(val);
        updates[storeKey] = Number.isNaN(num) ? val : num;
      }
    }
    if (Object.keys(updates).length > 0)
      gen.setParams(updates as Partial<typeof gen>);
  };

  const handleSendToCanvas = async () => {
    const file = await fetchRemoteImage(fullUrl, filename);
    await sendImageToCanvas(file);
  };

  const handleSendToImg2Img = () => {
    sendPromptToGeneration(genInfo.prompt, genInfo.negativePrompt || undefined);
  };

  const hasGenParams =
    !isVideo && (genInfo.prompt || Object.keys(genInfo.params).length > 0);

  return (
    <div className="flex flex-col h-full">
      {/* Preview — fills available space, shrinks as sections open */}
      <div className="flex-1 min-h-20 p-3 pb-0">
        <div className="rounded-md overflow-hidden border border-border bg-muted h-full">
          {isVideo ? (
            <video
              src={fullUrl}
              poster={selectedThumb.data}
              controls
              muted
              className="w-full h-full object-contain"
            />
          ) : (
            <img
              src={fullUrl}
              alt={filename}
              className="w-full h-full object-contain"
            />
          )}
        </div>
      </div>

      {/* Metadata — scrolls if it exceeds remaining space */}
      <ScrollArea className="min-h-0 shrink">
        <div className="p-3 space-y-3">

        {/* File info */}
        <SectionLeader title="File" collapsible defaultCollapsed>
          <div className="space-y-1">
            <MetaRow label="Name" value={filename} copyable />
            <MetaRow label="Size" value={formatSize(selectedThumb.size)} />
            <MetaRow
              label="Dimensions"
              value={`${selectedThumb.width} x ${selectedThumb.height}`}
              copyable
            />
            <MetaRow label="Modified" value={formatDate(selectedThumb.mtime)} />
            <MetaRow label="Path" value={selectedFile.relativePath} copyable />
          </div>
        </SectionLeader>

        {/* Video metadata */}
        {videoMeta && (
          <SectionLeader title="Video" collapsible defaultCollapsed>
            <div className="space-y-1">
              {videoMeta.duration && (
                <MetaRow label="Duration" value={videoMeta.duration} />
              )}
              {videoMeta.fps && <MetaRow label="FPS" value={videoMeta.fps} />}
              {videoMeta.frames && (
                <MetaRow label="Frames" value={videoMeta.frames} />
              )}
              {videoMeta.codec && (
                <MetaRow label="Codec" value={videoMeta.codec} />
              )}
            </div>
          </SectionLeader>
        )}

        {/* Prompt (positive + negative) */}
        {!isVideo && genInfo.prompt && (
          <SectionLeader
            title="Prompt"
            collapsible
            action={
              <div className="flex gap-0.5">
                <SmallButton
                  onClick={() => copyToClipboard(genInfo.prompt)}
                  title="Copy"
                >
                  <Copy size={10} />
                </SmallButton>
                <SmallButton onClick={copyPromptToGeneration} title="Use">
                  Use
                </SmallButton>
              </div>
            }
          >
            <p className="text-2xs text-foreground leading-relaxed break-words">
              {genInfo.prompt}
            </p>
            {genInfo.negativePrompt && (
              <SectionLeader
                title="Negative"
                level={2}
                action={
                  <div className="flex gap-0.5">
                    <SmallButton
                      onClick={() => copyToClipboard(genInfo.negativePrompt)}
                      title="Copy"
                    >
                      <Copy size={10} />
                    </SmallButton>
                    <SmallButton onClick={copyNegativeToGeneration} title="Use">
                      Use
                    </SmallButton>
                  </div>
                }
              >
                <p className="text-2xs text-foreground/70 leading-relaxed break-words">
                  {genInfo.negativePrompt}
                </p>
              </SectionLeader>
            )}
          </SectionLeader>
        )}

        {!isVideo && Object.keys(genInfo.params).length > 0 && (
          <SectionLeader
            title="Parameters"
            collapsible
            defaultCollapsed
            action={
              <CopyEntriesButton
                entries={Object.entries(genInfo.params)}
              />
            }
          >
            <ParamGroups params={genInfo.params} />
          </SectionLeader>
        )}

        <Separator />

        {/* Actions */}
        <div className="space-y-1.5">
          {hasGenParams && (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-6 text-2xs justify-start gap-2"
              onClick={useAllSettings}
            >
              <Wand2 size={12} /> Use all settings
            </Button>
          )}
          {!isVideo && (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-6 text-2xs justify-start gap-2"
              onClick={handleSendToCanvas}
            >
              <Paintbrush size={12} /> Send to canvas
            </Button>
          )}
          {hasGenParams && (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-6 text-2xs justify-start gap-2"
              onClick={handleSendToImg2Img}
            >
              <ImageIcon size={12} /> Send prompt to generation
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-full h-6 text-2xs justify-start gap-2"
            asChild
          >
            <a href={fullUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={12} /> Open full size
            </a>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full h-6 text-2xs justify-start gap-2"
            asChild
          >
            <a href={fullUrl} download={filename}>
              <Download size={12} /> Download
            </a>
          </Button>
        </div>
      </div>
      </ScrollArea>
    </div>
  );
}

function MetaRow({
  label,
  value,
  copyable,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group/row flex items-start gap-2">
      <span className="text-3xs text-muted-foreground w-16 flex-shrink-0">
        {label}
      </span>
      <span className="text-2xs text-foreground break-all flex-1">{value}</span>
      {copyable && (
        <button
          onClick={handleCopy}
          className="opacity-0 group-hover/row:opacity-100 p-0.5 rounded text-muted-foreground hover:text-foreground transition-opacity flex-shrink-0"
          title="Copy"
        >
          {copied ? (
            <Check size={10} className="text-green-500" />
          ) : (
            <Copy size={10} />
          )}
        </button>
      )}
    </div>
  );
}

const GENERATION_KEYS = new Set([
  "Steps", "Size-1", "Size-2", "Sampler", "Seed", "Batch count", "Batch size",
  "CFG scale", "CFG Scale", "CFG rescale", "Index", "Clip skip",
]);
const MODEL_KEYS = new Set([
  "Model", "Model hash", "VAE", "VAE hash", "Backend", "Pipeline", "Parser",
  "App", "Version",
]);

interface ParamGroup {
  label: string;
  entries: [string, string][];
}

function groupParams(params: Record<string, string>): ParamGroup[] {
  const generation: [string, string][] = [];
  const model: [string, string][] = [];
  const hires: [string, string][] = [];
  const detailer: [string, string][] = [];
  const other: [string, string][] = [];

  for (const [key, value] of Object.entries(params)) {
    const kl = key.toLowerCase();
    if (GENERATION_KEYS.has(key)) generation.push([key, value]);
    else if (MODEL_KEYS.has(key)) model.push([key, value]);
    else if (kl.startsWith("hires") || kl === "refine" || kl === "hires mode")
      hires.push([key, value]);
    else if (kl.startsWith("detailer")) detailer.push([key, value]);
    else other.push([key, value]);
  }

  const groups: ParamGroup[] = [];
  if (generation.length) groups.push({ label: "Generation", entries: generation });
  if (model.length) groups.push({ label: "Model", entries: model });
  if (hires.length) groups.push({ label: "Hires", entries: hires });
  if (detailer.length) groups.push({ label: "Detailer", entries: detailer });
  if (other.length) groups.push({ label: "Other", entries: other });
  return groups;
}

function entriesToText(entries: [string, string][]): string {
  return entries.map(([k, v]) => `${k}: ${v}`).join("\n");
}

function CopyEntriesButton({ entries }: { entries: [string, string][] }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(entriesToText(entries)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={handleCopy}
      className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
      title="Copy all"
    >
      {copied ? (
        <Check size={10} className="text-green-500" />
      ) : (
        <Copy size={10} />
      )}
    </button>
  );
}

function ParamGroups({ params }: { params: Record<string, string> }) {
  const groups = useMemo(() => groupParams(params), [params]);

  // If only one group, skip sub-headers
  if (groups.length === 1) {
    return (
      <ParamGrid entries={groups[0].entries} />
    );
  }

  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <SectionLeader
          key={g.label}
          title={g.label}
          level={2}
          action={<CopyEntriesButton entries={g.entries} />}
        >
          <ParamGrid entries={g.entries} />
        </SectionLeader>
      ))}
    </div>
  );
}

function ParamGrid({ entries }: { entries: [string, string][] }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
      {entries.map(([key, value]) => (
        <ParamCell key={key} label={key} value={value} />
      ))}
    </div>
  );
}

function ParamCell({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const isWide = label.length + value.length > 25;

  const handleCopy = () => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className={cn(
        "group/cell flex items-baseline gap-1.5 min-w-0",
        isWide && "col-span-2",
      )}
    >
      <span className="text-3xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-2xs text-foreground font-mono tabular-nums truncate">
        {value}
      </span>
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover/cell:opacity-100 p-0.5 rounded text-muted-foreground hover:text-foreground transition-opacity shrink-0 ml-auto"
        title="Copy"
      >
        {copied ? (
          <Check size={8} className="text-green-500" />
        ) : (
          <Copy size={8} />
        )}
      </button>
    </div>
  );
}

function SmallButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="px-1.5 py-0.5 text-4xs rounded bg-accent/50 text-accent-foreground hover:bg-accent transition-colors"
    >
      {children}
    </button>
  );
}
