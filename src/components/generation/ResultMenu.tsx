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
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { SlotMenuItem } from "@/components/ui/slot-row";
import { TrashedFileItems } from "./OutputTrash";
import { useRunAgain } from "@/hooks/useRunAgain";
import { useJobFact } from "@/hooks/useJobFact";
import { hasLegacyInputs } from "@/inputs/legacyResult";
import { saveInputsAsSet } from "@/inputs/library";
import { resultActions, type ResultAction, type Slot } from "@/lib/jobs/cardActions";
import {
  reasonText,
  RESTORE_BOTH,
  RESTORE_INPUTS,
  RESTORE_SETTINGS,
  RUN_AGAIN,
  slotWords,
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
  icon,
  label,
  slot = null,
  busy = false,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  /** Why the item cannot act, or how it will; none for an item that always can. */
  slot?: Slot<ResultAction> | null;
  busy?: boolean;
  onSelect: () => void;
}) {
  return (
    <SlotMenuItem
      icon={icon}
      label={label}
      {...(slot ? slotWords(slot) : {})}
      busy={busy}
      className="text-2xs"
      onAct={onSelect}
    />
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
          slot={reasons.restoreSettings}
          onSelect={() => restoreSettings(target())}
        />
        <Item
          icon={ImageDown}
          label={RESTORE_INPUTS}
          slot={reasons.restoreInputs}
          onSelect={() => void restoreInputs(target())}
        />
        <Item
          icon={ArchiveRestore}
          label={RESTORE_BOTH}
          slot={reasons.restoreBoth}
          onSelect={() => void restoreSettingsAndInputs(target())}
        />
        <Item
          icon={Repeat2}
          label={RUN_AGAIN}
          slot={reasons.runAgain}
          busy={running}
          onSelect={() => {
            if (result.jobId) void runAgain(result.jobId);
          }}
        />
        <Item
          icon={BookmarkPlus}
          label="Save inputs to the library"
          slot={reasons.saveInputs}
          onSelect={() =>
            void target()
              .inputs({})
              .then((loaded) => {
                if (loaded) void saveInputsAsSet(loaded.inputs, loaded.maps);
                else toast.info(reasonText("noRecord"));
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
        <TrashedFileItems url={result.images[imageIndex]} className="text-2xs" />
      </ContextMenuContent>
    </ContextMenu>
  );
}
