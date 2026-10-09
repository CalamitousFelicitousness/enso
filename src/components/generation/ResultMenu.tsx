import {
  ArchiveRestore,
  ArrowUpCircle,
  BookmarkPlus,
  Download,
  GitCompare,
  GitCompareArrows,
  History,
  ImageDown,
  ImagePlus,
  Repeat2,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useRunAgain } from "@/hooks/useRunAgain";
import { useJobFact } from "@/inputs/jobs";
import { hasLegacyInputs } from "@/inputs/legacyResult";
import { saveInputsAsSet } from "@/inputs/library";
import { resultActions, type ActionReason } from "@/lib/jobs/cardActions";
import {
  reasonText,
  RESTORE_BOTH,
  RESTORE_INPUTS,
  RESTORE_SETTINGS,
  RUN_AGAIN,
} from "@/lib/jobs/text";
import {
  restoreInputs,
  restoreSettings,
  restoreSettingsAndInputs,
  resultTarget,
} from "@/lib/request/restore";
import type { GenerationResult } from "@/stores/generationStore";
import { download, sendToCanvas, sendToUpscale } from "./resultActions";

interface ResultMenuProps {
  result: GenerationResult;
  imageIndex: number;
  /** Open the settings comparison for the result. */
  onCompareSettings: (result: GenerationResult) => void;
  /** Pick this image as the first of a picture comparison. */
  onCompareWith: (resultId: string, imageIndex: number) => void;
  children: ReactNode;
}

function Item({
  icon: Icon,
  label,
  reason = null,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  reason?: ActionReason | null;
  onSelect: () => void;
}) {
  return (
    <ContextMenuItem disabled={reason !== null} onSelect={onSelect} className="text-2xs">
      <Icon size={14} />
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {reason && (
          <span className="text-3xs leading-tight text-muted-foreground">{reasonText(reason)}</span>
        )}
      </span>
    </ContextMenuItem>
  );
}

/** A result thumbnail's menu: restores and Run again, each with its reason
 * when it cannot act, then the picture's actions and the comparisons. */
export function ResultMenu({
  result,
  imageIndex,
  onCompareSettings,
  onCompareWith,
  children,
}: ResultMenuProps) {
  const facts = useJobFact(result.jobId);
  const { runAgain, isRunning } = useRunAgain();
  const reasons = resultActions(
    {
      jobId: result.jobId ?? null,
      type: result.type ?? null,
      legacyInputs: hasLegacyInputs(result),
    },
    facts,
  );
  const target = () => resultTarget(result, imageIndex);
  const running = result.jobId ? isRunning(result.jobId) : false;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <Item
          icon={History}
          label={RESTORE_SETTINGS}
          reason={reasons.restoreSettings}
          onSelect={() => restoreSettings(target())}
        />
        <Item
          icon={ImageDown}
          label={RESTORE_INPUTS}
          reason={reasons.restoreInputs}
          onSelect={() => void restoreInputs(target())}
        />
        <Item
          icon={ArchiveRestore}
          label={RESTORE_BOTH}
          reason={reasons.restoreBoth}
          onSelect={() => void restoreSettingsAndInputs(target())}
        />
        <Item
          icon={Repeat2}
          label={RUN_AGAIN}
          reason={reasons.runAgain}
          onSelect={() => {
            if (result.jobId && !running) void runAgain(result.jobId);
          }}
        />
        <Item
          icon={BookmarkPlus}
          label="Save inputs to the library"
          reason={reasons.saveInputs}
          onSelect={() =>
            void target()
              .inputs()
              .then((loaded) => {
                if (loaded) void saveInputsAsSet(loaded.inputs, loaded.maps);
                else toast.info(reasonText("notStored"));
              })
          }
        />
        <ContextMenuSeparator />
        <Item
          icon={ImagePlus}
          label="Send to canvas"
          onSelect={() => sendToCanvas(result, imageIndex)}
        />
        <Item
          icon={ArrowUpCircle}
          label="Send to upscale"
          onSelect={() => sendToUpscale(result, imageIndex)}
        />
        <Item icon={Download} label="Download" onSelect={() => download(result, imageIndex)} />
        <ContextMenuSeparator />
        <Item
          icon={GitCompare}
          label="Compare and restore..."
          onSelect={() => onCompareSettings(result)}
        />
        <Item
          icon={GitCompareArrows}
          label="Compare with..."
          onSelect={() => onCompareWith(result.id, imageIndex)}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
