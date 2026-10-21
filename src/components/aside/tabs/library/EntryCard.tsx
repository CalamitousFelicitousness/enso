// One saved frame, set or recipe. Clicking a frame adds it to the inputs,
// clicking a set puts it in their place, clicking a recipe opens Restore for
// it; the row under the name says which, and holds the other recall or Run,
// Pin and Remove. Rename is in the menu and on F2, never on
// a double click, which would run the click twice. An entry an older build
// kept in this browser recalls and nothing else until it is moved; one a
// newer build saved can only go to the trash.

import { useEffect, useRef, useState } from "react";
import {
  ArchiveRestore,
  ArrowDownToLine,
  GitCompare,
  History,
  ImageDown,
  MousePointerClick,
  Pencil,
  Pin,
  PinOff,
  Play,
  Replace,
  ScrollText,
  Search,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { blobUrl } from "@/api/blobs";
import { mediaUrl } from "@/api/session";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { SlotMenuItem } from "@/components/ui/slot-row";
import { ActionSlot } from "@/components/ui/action-slot";
import { useDragSource } from "@/hooks/useDragSource";
import { useNearViewport } from "@/hooks/useNearViewport";
import { renameEntry, setPinned, trashEntry } from "@/inputs/library";
import { entryTarget, runRecipe, useRecipeRuns } from "@/inputs/recipes";
import { recallEntry, recallLegacyEntry, type RecallMode } from "@/inputs/recall";
import {
  ADD_TO_INPUTS,
  entryLine,
  entryName,
  entryVerb,
  entryVerbHint,
  NEWER_ENTRY,
  PIN_ENTRY,
  REMOVE_ENTRY,
  RENAME_ENTRY,
  REPLACE_INPUTS,
  UNPIN_ENTRY,
} from "@/lib/inputs/text";
import {
  reasonText,
  RESTORE_BOTH,
  RESTORE_DIALOG,
  RESTORE_INPUTS,
  RESTORE_SETTINGS,
} from "@/lib/jobs/text";
import { MOVE_FIRST } from "@/lib/media/text";
import { failedWith } from "@/lib/mediaFiles";
import {
  ALL_MODELS_FOUND,
  FIND_ON_CIVITAI,
  READ_RECIPE_FAILED,
  RUN_RECIPE,
} from "@/lib/recipes/text";
import { restoreFrom } from "@/lib/request/restore";
import { useRestoreDialogStore } from "@/stores/restoreDialogStore";
import { cn } from "@/lib/utils";
import { EntryThumbs } from "./EntryThumbs";
import type { EntryModel } from "./entryModel";
import { FindModelDialog } from "./FindModelDialog";
import { useRecipeModels } from "./useRecipeModels";

const RECALL: Record<RecallMode, { label: string; icon: LucideIcon }> = {
  add: { label: ADD_TO_INPUTS, icon: ArrowDownToLine },
  replace: { label: REPLACE_INPUTS, icon: Replace },
};

interface EntryCardProps {
  entry: EntryModel;
  /** 0 for the one card of the grid that Tab reaches. */
  tabIndex: 0 | -1;
  onFocusCard: (id: string) => void;
}

export function EntryCard({ entry, tabIndex, onFocusCard }: EntryCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLButtonElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const near = useNearViewport(cardRef);
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [finding, setFinding] = useState(false);
  const isRecipe = entry.kind === "recipe";
  const models = useRecipeModels(entry.recipe);
  const running = useRecipeRuns((s) => s.running.has(entry.id));
  const openRestore = useRestoreDialogStore((s) => s.openEntry);
  const server = entry.source === "server";
  const first = entry.cells[0];
  const dragPath = first?.kind === "server" && !first.lost ? blobUrl(first.hash) : null;
  const dragImage = dragPath ? mediaUrl(dragPath) : undefined;
  const drag = useDragSource(
    renaming || !server || entry.newer || entry.noInputs
      ? null
      : { type: "library-entry", entryId: entry.id, src: dragImage },
  );

  // why each action cannot run, or null
  const recallReason = entry.newer ? NEWER_ENTRY : null;
  const inputsReason = recallReason ?? (entry.noInputs ? reasonText("recipeNoInputs") : null);
  const changeReason = entry.newer ? NEWER_ENTRY : server ? null : MOVE_FIRST;
  const removeReason = server ? null : MOVE_FIRST;

  const primary: RecallMode = entry.kind === "set" ? "replace" : "add";
  const other: RecallMode = primary === "add" ? "replace" : "add";

  const recall = (mode: RecallMode) => {
    const reason = isRecipe ? inputsReason : recallReason;
    if (reason) {
      toast.info(reason);
      return;
    }
    if (busy) return;
    setBusy(true);
    const run = server ? recallEntry(entry.id, mode) : recallLegacyEntry(entry.id, mode);
    void run.finally(() => setBusy(false));
  };
  /** What a click and Enter do: a recipe opens Restore, an entry recalls. */
  const activate = () => {
    if (!isRecipe) recall(primary);
    else if (recallReason) toast.info(recallReason);
    else openRestore(entry.id);
  };
  const run = () => {
    if (recallReason) toast.info(recallReason);
    else void runRecipe(entry.id);
  };
  const restore = (kind: "settings" | "inputs" | "both") => {
    const reason = kind === "settings" ? recallReason : inputsReason;
    if (reason) {
      toast.info(reason);
      return;
    }
    restoreFrom(entryTarget(entry.id), kind).catch(failedWith(READ_RECIPE_FAILED));
  };
  const find = () => {
    if (models.missing.length === 0) toast.info(ALL_MODELS_FOUND);
    else setFinding(true);
  };
  const togglePin = () => void setPinned(entry.id, !entry.pinned);
  const remove = () => {
    if (removeReason) toast.info(removeReason);
    else void trashEntry(entry.id);
  };
  const startRename = () => {
    if (changeReason) toast.info(changeReason);
    else setRenaming(true);
  };

  useEffect(() => {
    if (!renaming) return;
    renameRef.current?.focus();
    renameRef.current?.select();
  }, [renaming]);

  const finishRename = (name: string | null) => {
    setRenaming(false);
    if (name !== null) void renameEntry(entry.id, name);
    requestAnimationFrame(() => mainRef.current?.focus());
  };

  /** The card's menu, opened from the keyboard where the pointer would. */
  const openMenu = () => {
    const card = cardRef.current;
    if (!card) return;
    const box = card.getBoundingClientRect();
    card.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: box.left + 16,
        clientY: box.top + 16,
      }),
    );
  };

  const onMainKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Delete") {
      e.preventDefault();
      remove();
    } else if (e.key === "F2") {
      e.preventDefault();
      startRename();
    } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      openMenu();
    }
  };

  const pinLabel = entry.pinned ? UNPIN_ENTRY : PIN_ENTRY;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-noninteractive-element-interactions -- a click anywhere on the card does what its main button does; the button is the control keyboards and screen readers reach */}
          <div
            ref={cardRef}
            role="listitem"
            data-entry-id={entry.id}
            aria-busy={busy || undefined}
            className={cn(
              "group flex min-w-0 flex-col rounded-md border border-border bg-card transition-colors hover:border-foreground/20",
              busy && "opacity-60",
            )}
            {...drag}
            onClick={(e) => {
              // the second click of a double click would recall it again
              if (e.detail > 1 || renaming) return;
              activate();
            }}
          >
            <button
              ref={mainRef}
              type="button"
              data-entry-main
              tabIndex={tabIndex}
              aria-label={entryName(entry.name, entry.shape, entry.pinned)}
              onFocus={() => onFocusCard(entry.id)}
              onKeyDown={onMainKeyDown}
              className="block w-full rounded-t-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <EntryThumbs
                cells={entry.cells}
                more={entry.more}
                active={near}
                note={entry.newer ? NEWER_ENTRY : null}
                empty={isRecipe ? ScrollText : null}
              />
            </button>
            <div className="flex min-w-0 flex-col gap-0.5 px-1.5 pt-1">
              <div className="flex min-w-0 items-center gap-1">
                {renaming ? (
                  <input
                    ref={renameRef}
                    defaultValue={entry.name}
                    aria-label={RENAME_ENTRY}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") finishRename(e.currentTarget.value);
                      else if (e.key === "Escape") finishRename(null);
                    }}
                    onBlur={(e) => finishRename(e.currentTarget.value)}
                    className="h-5 min-w-0 flex-1 rounded border border-border bg-input/50 px-1 text-2xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-2xs" title={entry.name}>
                    {entry.name}
                  </span>
                )}
                {entry.pinned && (
                  <Pin size={10} className="shrink-0 text-muted-foreground" aria-hidden />
                )}
              </div>
              <span className="truncate text-4xs text-muted-foreground">
                {entryLine(entry.shape, models.line)}
              </span>
            </div>
            <div className="flex h-6 items-center gap-0.5 px-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <span
                className="flex min-w-0 flex-1 items-center gap-0.5 text-4xs text-muted-foreground"
                title={entryVerbHint(entry.kind)}
              >
                <MousePointerClick size={10} className="shrink-0" aria-hidden />
                <span className="truncate">{entryVerb(entry.kind)}</span>
              </span>
              {isRecipe ? (
                <ActionSlot
                  label={RUN_RECIPE}
                  icon={Play}
                  reason={recallReason}
                  note={models.runNote}
                  busy={running}
                  tabIndex={-1}
                  onAct={run}
                />
              ) : (
                <ActionSlot
                  label={RECALL[other].label}
                  icon={RECALL[other].icon}
                  reason={recallReason}
                  busy={busy}
                  tabIndex={-1}
                  onAct={() => recall(other)}
                />
              )}
              <ActionSlot
                label={pinLabel}
                icon={entry.pinned ? PinOff : Pin}
                reason={changeReason}
                tabIndex={-1}
                onAct={togglePin}
              />
              <ActionSlot
                label={REMOVE_ENTRY}
                icon={Trash2}
                reason={removeReason}
                tabIndex={-1}
                onAct={remove}
              />
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          {isRecipe ? (
            <>
              <SlotMenuItem
                icon={GitCompare}
                label={RESTORE_DIALOG}
                reason={recallReason}
                onAct={activate}
              />
              <SlotMenuItem
                icon={History}
                label={RESTORE_SETTINGS}
                reason={recallReason}
                onAct={() => restore("settings")}
              />
              <SlotMenuItem
                icon={ImageDown}
                label={RESTORE_INPUTS}
                reason={inputsReason}
                onAct={() => restore("inputs")}
              />
              <SlotMenuItem
                icon={ArchiveRestore}
                label={RESTORE_BOTH}
                reason={inputsReason}
                onAct={() => restore("both")}
              />
              <SlotMenuItem
                icon={Play}
                label={RUN_RECIPE}
                reason={recallReason}
                note={models.runNote}
                busy={running}
                onAct={run}
              />
              <SlotMenuItem {...RECALL.add} reason={inputsReason} onAct={() => recall("add")} />
              <SlotMenuItem
                icon={Search}
                label={FIND_ON_CIVITAI}
                reason={recallReason}
                onAct={find}
              />
            </>
          ) : (
            <>
              <SlotMenuItem
                {...RECALL[primary]}
                reason={recallReason}
                onAct={() => recall(primary)}
              />
              <SlotMenuItem {...RECALL[other]} reason={recallReason} onAct={() => recall(other)} />
            </>
          )}
          <ContextMenuSeparator />
          <SlotMenuItem
            icon={entry.pinned ? PinOff : Pin}
            label={pinLabel}
            reason={changeReason}
            onAct={togglePin}
          />
          <SlotMenuItem
            icon={Pencil}
            label={RENAME_ENTRY}
            reason={changeReason}
            onAct={startRename}
          />
          <ContextMenuSeparator />
          <SlotMenuItem
            icon={Trash2}
            label={REMOVE_ENTRY}
            reason={removeReason}
            destructive
            onAct={remove}
          />
        </ContextMenuContent>
      </ContextMenu>
      {isRecipe && (
        <FindModelDialog open={finding} onOpenChange={setFinding} items={models.missing} />
      )}
    </>
  );
}
