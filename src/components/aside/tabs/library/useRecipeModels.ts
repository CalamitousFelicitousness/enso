import { useCurrentCheckpoint, useModelList } from "@/api/hooks/useModels";
import { useLoraList } from "@/api/hooks/useNetworks";
import { noteText } from "@/lib/jobs/text";
import { recipeStates } from "@/lib/recipes/models";
import type { RecipeHead } from "@/lib/recipes/recipe";
import { modelLineText, runsOnLoadedText } from "@/lib/recipes/text";
import { useModelHashStore } from "@/stores/modelHashStore";
import type { FindItem } from "./FindModelDialog";

export interface RecipeModels {
  /** The card's models line; empty until the lists are read. */
  line: string;
  /** What Find on CivitAI lists: the models this server lacks or holds as another file. */
  missing: FindItem[];
  /** How Run treats the model, when that is worth knowing first. */
  runNote: string | null;
}

const NONE: RecipeModels = { line: "", missing: [], runNote: null };

/** How a recipe's models stand on this server, from the model lists as they are now. */
export function useRecipeModels(head: RecipeHead | null): RecipeModels {
  const checkpoints = useModelList().data;
  const loras = useLoraList(head !== null && head.networks.length > 0).data;
  const loaded = useCurrentCheckpoint().data;
  const downloads = useModelHashStore((s) => s.downloads);
  if (!head || !checkpoints || (head.networks.length > 0 && !loras)) return NONE;
  const states = recipeStates(head, checkpoints, loras ?? [], downloads);
  const model = head.checkpoint;
  const fact = states.checkpoint;
  const missing: FindItem[] = [];
  if (model && fact && (fact.state === "missing" || fact.state === "otherFile")) {
    missing.push({
      key: "checkpoint",
      kind: "checkpoint",
      name: model.name,
      state: fact.state,
      sha256: model.sha256,
      shorthash: model.shorthash,
    });
  }
  for (const { id, state } of states.networks) {
    if (state !== "missing" && state !== "otherFile") continue;
    missing.push({
      key: `${id.kind}:${id.name}`,
      kind: "lora",
      name: id.name,
      state,
      sha256: id.sha256,
      shorthash: null,
    });
  }
  let runNote: string | null = null;
  if (model && fact) {
    if (fact.state !== "installed") runNote = runsOnLoadedText(model.name, fact.state);
    else if (fact.match && loaded?.loaded && loaded.title !== fact.match.title) {
      runNote = noteText("loadsModel", fact.match.model_name);
    }
  }
  return {
    line: modelLineText(
      model && fact ? { name: model.name, state: fact.state } : null,
      states.missingNetworks,
    ),
    missing,
    runNote,
  };
}
