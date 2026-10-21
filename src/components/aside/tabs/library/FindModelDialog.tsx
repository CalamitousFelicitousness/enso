import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { useCivitDownload, useCivitVersionByHash } from "@/api/hooks/useCivitai";
import type { CivitFile } from "@/api/types/civitai";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { aboutSize } from "@/lib/media/text";
import type { ModelState } from "@/lib/recipes/models";
import {
  ALL_MODELS_FOUND,
  DOWNLOAD_MODEL,
  DOWNLOAD_QUEUED,
  FIND_DESCRIPTION,
  FIND_ON_CIVITAI,
  modelStateLongText,
  NO_LORA_IDENTITY,
  NO_MODEL_IDENTITY,
  NOT_ON_CIVITAI,
  OPEN_DOWNLOADS,
} from "@/lib/recipes/text";
import { useModelHashStore } from "@/stores/modelHashStore";
import { useUiStore } from "@/stores/uiStore";

/** A model a recipe names that this server lacks or holds as another file. */
export interface FindItem {
  key: string;
  kind: "checkpoint" | "lora";
  name: string;
  state: ModelState;
  sha256: string | null;
  /** sdnext's short hash of a checkpoint, the first ten hex of its digest. */
  shorthash: string | null;
}

const DIGEST = /^[0-9a-f]{64}$/;

function primaryFile(files: readonly CivitFile[]): CivitFile | null {
  return files.find((f) => f.primary) ?? files[0] ?? null;
}

/** One model: its state, and on Find the version CivitAI holds under its hash. */
function FindRow({ item }: { item: FindItem }) {
  const query = item.sha256 ?? (item.kind === "checkpoint" ? item.shorthash : null);
  // the lookup runs only once Find is clicked
  const [hash, setHash] = useState<string | null>(null);
  const lookup = useCivitVersionByHash(hash);
  const download = useCivitDownload();
  const version = lookup.data ?? null;
  const file = version ? primaryFile(version.files) : null;

  const start = () => {
    if (!version || !file) return;
    download.mutate(
      { version_id: version.id, file_id: file.id },
      {
        onSuccess: () => {
          const digest = item.sha256 ?? file.hashes.SHA256?.toLowerCase() ?? null;
          if (digest && DIGEST.test(digest)) {
            useModelHashStore.getState().remember({ sha256: digest, filename: file.name });
          }
        },
      },
    );
  };

  return (
    <li className="space-y-1 py-1.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-2xs" title={item.name}>
            {item.name}
          </p>
          <p className="text-3xs text-muted-foreground">{modelStateLongText(item.state)}</p>
        </div>
        <Button
          variant="outline"
          size="xs"
          disabled={!query || hash !== null}
          onClick={() => setHash(query)}
        >
          {lookup.isFetching ? <Loader2 className="animate-spin" /> : <Search />}
          {FIND_ON_CIVITAI}
        </Button>
      </div>
      {!query && (
        <p className="text-3xs text-muted-foreground">
          {item.kind === "lora" ? NO_LORA_IDENTITY : NO_MODEL_IDENTITY}
        </p>
      )}
      {lookup.isError && <p className="text-3xs text-muted-foreground">{NOT_ON_CIVITAI}</p>}
      {version && file && (
        <div className="flex items-center gap-2 rounded-sm bg-muted/40 px-2 py-1">
          <div className="min-w-0 flex-1 text-3xs">
            <p className="truncate" title={version.model?.name ?? version.name}>
              {version.model?.name ? `${version.model.name} · ${version.name}` : version.name}
              {version.baseModel ? ` · ${version.baseModel}` : ""}
            </p>
            <p className="truncate text-muted-foreground" title={file.name}>
              {file.name} · {aboutSize(file.sizeKB * 1024)}
            </p>
          </div>
          {download.isSuccess ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() =>
                useUiStore.getState().openRightSubTab({ rightTab: "models", subTab: "CivitAI" })
              }
            >
              {DOWNLOAD_QUEUED} · {OPEN_DOWNLOADS}
            </Button>
          ) : (
            <Button size="xs" disabled={download.isPending} onClick={start}>
              {download.isPending && <Loader2 className="animate-spin" />}
              {DOWNLOAD_MODEL}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/** Find on CivitAI: each model the recipe names that this server lacks, looked
 * up by its hash through the server on a click, and downloaded by the server. */
export function FindModelDialog({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly FindItem[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{FIND_ON_CIVITAI}</DialogTitle>
          <DialogDescription className="text-2xs">{FIND_DESCRIPTION}</DialogDescription>
        </DialogHeader>
        {items.length === 0 ? (
          <p className="text-2xs text-muted-foreground">{ALL_MODELS_FOUND}</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {items.map((item) => (
              <FindRow key={item.key} item={item} />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
