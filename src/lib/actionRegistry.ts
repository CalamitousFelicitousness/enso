import type { LucideIcon } from "lucide-react";
import {
  RefreshCw, Download, Upload,
  ImageIcon, Video, Sparkles, MessageSquare, Images,
  Settings,
} from "lucide-react";
import { NAV_ITEMS, IMAGES_SUB_TABS, RIGHT_TABS } from "@/lib/constants";
import { PARAM_MAP } from "@/lib/paramMap.generated";
import { getAllCommands } from "@/lib/commandRegistry";
import type { PaletteCommand } from "@/lib/commandRegistry";
import type { NavigateTarget } from "@/lib/navigateToParam";
import type { ImagesSubTab } from "@/stores/uiStore";
import type { RightTab } from "@/lib/constants";

interface PaletteActionBase {
  id: string;
  label: string;
  icon: LucideIcon;
  group: string;
  keywords: string[];
  /** HTML-stripped excerpt of help text, for low-priority fuzzy matching. */
  helpExcerpt?: string;
  shortcutId?: string;
  showOnlyInSearch?: boolean;
}

export type PaletteAction =
  | (PaletteActionBase & { kind: "navigate"; target: NavigateTarget })
  | (PaletteActionBase & { kind: "command"; commandId: string });

const NAV_ICONS: Record<string, LucideIcon> = {
  images: ImageIcon,
  video: Video,
  process: Sparkles,
  caption: MessageSquare,
  gallery: Images,
};

const TAB_ICONS: Record<string, LucideIcon> = {};
for (const t of IMAGES_SUB_TABS) TAB_ICONS[t.id] = t.icon;

const TAB_LABELS: Record<string, string> = {};
for (const t of IMAGES_SUB_TABS) TAB_LABELS[t.id] = t.label;

export function buildActions(commands?: PaletteCommand[]): PaletteAction[] {
  const cmds = commands ?? getAllCommands();
  const actions: PaletteAction[] = [];

  // --- Commands from registry (Generate, Interrupt, PNG Info, etc.) ---
  for (const cmd of cmds) {
    actions.push({
      kind: "command",
      id: cmd.id,
      label: cmd.label,
      icon: cmd.icon ?? Settings,
      group: cmd.group,
      keywords: cmd.keywords ?? [],
      shortcutId: cmd.shortcutId,
      showOnlyInSearch: cmd.showOnlyInSearch,
      commandId: cmd.id,
    });
  }

  // --- Model panel shortcuts (navigate to Models, no imperative action yet) ---
  actions.push({
    kind: "navigate",
    id: "refresh-models",
    label: "Refresh model list",
    icon: RefreshCw,
    group: "Actions",
    keywords: ["model", "checkpoint", "scan"],
    target: { rightTab: "models" },
  });

  actions.push({
    kind: "navigate",
    id: "reload-model",
    label: "Reload current model",
    icon: Download,
    group: "Actions",
    keywords: ["model", "checkpoint", "load"],
    target: { rightTab: "models" },
  });

  actions.push({
    kind: "navigate",
    id: "unload-model",
    label: "Unload model",
    icon: Upload,
    group: "Actions",
    keywords: ["model", "checkpoint", "free", "memory"],
    target: { rightTab: "models" },
  });

  // --- Settings search ---
  actions.push({
    kind: "navigate",
    id: "search-settings",
    label: "Search settings...",
    icon: Settings,
    group: "Navigation",
    keywords: ["settings", "search", "find", "option", "preference", "configure"],
    target: { rightTab: "settings" },
  });

  // --- Navigation: views ---
  for (const nav of NAV_ITEMS) {
    actions.push({
      kind: "navigate",
      id: `nav-${nav.id}`,
      label: `Go to ${nav.label}`,
      icon: NAV_ICONS[nav.id] ?? nav.icon,
      group: "Navigation",
      keywords: ["view", "page", "navigate", nav.label.toLowerCase()],
      target: { view: nav.id },
    });
  }

  // --- Navigation: images sub-tabs ---
  for (const tab of IMAGES_SUB_TABS) {
    actions.push({
      kind: "navigate",
      id: `subtab-${tab.id}`,
      label: `Images › ${tab.label}`,
      icon: tab.icon,
      group: "Navigation",
      keywords: ["tab", "images", tab.label.toLowerCase()],
      target: { tab: tab.id as ImagesSubTab },
    });
  }

  // --- Navigation: right panel tabs ---
  for (const tab of RIGHT_TABS) {
    actions.push({
      kind: "navigate",
      id: `right-${tab.id}`,
      label: `Open ${tab.label} panel`,
      icon: tab.icon,
      group: "Navigation",
      keywords: ["panel", "right panel", tab.label.toLowerCase()],
      target: { rightTab: tab.id as RightTab },
    });
  }

  // --- Parameter navigation (search-only) ---
  for (const entry of PARAM_MAP) {
    const tabLabel = TAB_LABELS[entry.tab] ?? entry.tab;
    const icon = TAB_ICONS[entry.tab] ?? Settings;
    actions.push({
      kind: "navigate",
      id: `param-${entry.tab}-${entry.param}`,
      label: entry.label,
      icon,
      group: tabLabel,
      keywords: [...entry.keywords, entry.param, entry.section],
      ...(entry.helpExcerpt ? { helpExcerpt: entry.helpExcerpt } : {}),
      target: { tab: entry.tab, section: entry.section, param: entry.param },
      showOnlyInSearch: true,
    });
  }

  return actions;
}
