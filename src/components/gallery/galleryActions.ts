import type { LucideIcon } from "lucide-react";
import type { GalleryFile } from "@/api/types/gallery";

/** An action the selection bar and the grid menu offer on the files a Gallery
 * action takes: four in a folder, four in the Trash folder. */
export interface GalleryAction {
  id: "trash" | "delete-now" | "move" | "download" | "restore" | "restore-to";
  label: string;
  icon: LucideIcon;
  /** Why it cannot act now; null when it can. */
  reason: string | null;
  /** It is under way. */
  busy: boolean;
  /** It removes files: drawn in the destructive color. */
  destructive: boolean;
  run: () => void;
}

/** What the metadata panel offers on its own file in the Trash folder. */
export interface TrashFileActions {
  restore: (file: GalleryFile) => void;
  deleteNow: (file: GalleryFile) => void;
  busy: boolean;
}
