import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BookMarked,
  CircleArrowUp,
  CloudDownload,
  Combine,
  FolderInput,
  Globe,
  HardDrive,
  LayoutDashboard,
  List,
  MemoryStick,
  PackageCheck,
  Replace,
  Scissors,
  ShieldCheck,
  Tags,
  Timer,
  ImageIcon,
  Video,
  Sparkles,
  MessageSquare,
  Images,
  Type,
  SlidersHorizontal,
  Compass,
  Wand2,
  ScanSearch,
  Settings2,
  Layers,
  FileCode,
  Palette,
  BookOpen,
  GitBranch,
  MessageCircle,
  Users,
  Gauge,
  LayoutGrid,
  Box,
  Puzzle,
  Settings,
  Monitor,
  Clock,
  Info,
  Terminal,
  ListOrdered,
  CloudCog,
  Trash2,
  Film,
  FileVideo,
} from "lucide-react";

export type NavView = "images" | "video" | "process" | "caption" | "gallery";

export interface NavItem {
  id: NavView;
  label: string;
  icon: LucideIcon;
  capability?: keyof import("@/api/types/server").ServerCapabilities;
}

export interface SubTabItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Words the palette also finds it by. */
  keywords?: readonly string[];
}

export interface ExternalLink {
  label: string;
  icon: LucideIcon;
  url: string;
}

export type RightTab =
  | "quick-settings"
  | "networks"
  | "library"
  | "models"
  | "providers"
  | "queue"
  | "extensions"
  | "settings"
  | "system"
  | "history"
  | "info"
  | "console";

export interface RightTabItem {
  id: RightTab;
  label: string;
  icon: LucideIcon;
  hasSeparatorAfter?: boolean;
}

export const RIGHT_TABS: RightTabItem[] = [
  { id: "quick-settings", label: "Quick Settings", icon: Gauge },
  { id: "networks", label: "Networks", icon: LayoutGrid },
  { id: "library", label: "Library", icon: BookMarked },
  { id: "models", label: "Models", icon: Box },
  { id: "providers", label: "Providers", icon: CloudCog },
  { id: "queue", label: "Queue", icon: ListOrdered, hasSeparatorAfter: true },
  { id: "extensions", label: "Extensions", icon: Puzzle },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "system", label: "System", icon: Monitor },
  { id: "history", label: "History", icon: Clock },
  { id: "info", label: "Info", icon: Info },
  { id: "console", label: "Console", icon: Terminal },
];

/** Primary nav items (Left Rail) */
export const NAV_ITEMS: NavItem[] = [
  { id: "images", label: "Images", icon: ImageIcon },
  { id: "video", label: "Video", icon: Video, capability: "video" },
  { id: "process", label: "Process", icon: Sparkles },
  { id: "caption", label: "Caption", icon: MessageSquare },
  { id: "gallery", label: "Gallery", icon: Images },
];

/** Sub-tabs for the Images view (matches SD.Next control tab structure) */
export const IMAGES_SUB_TABS = [
  { id: "prompts", label: "Prompts", icon: Type },
  { id: "sampler", label: "Sampler", icon: SlidersHorizontal },
  { id: "guidance", label: "Guidance", icon: Compass },
  { id: "refine", label: "Refine", icon: Wand2 },
  { id: "detail", label: "Detail", icon: ScanSearch },
  { id: "advanced", label: "Advanced", icon: Settings2 },
  { id: "color", label: "Color", icon: Palette },
  { id: "input", label: "Input", icon: Layers },
  { id: "scripts", label: "Scripts", icon: FileCode },
] as const satisfies readonly SubTabItem[];

/** Derived from the registry so ids and the union cannot drift apart. */
export type ImagesSubTab = (typeof IMAGES_SUB_TABS)[number]["id"];

/** Sub-tabs for the Video view. Which ones a model actually offers is
 * decided by visibleVideoSubTabs in @/lib/video/subTabs. */
export const VIDEO_SUB_TABS = [
  { id: "prompts", label: "Prompts", icon: Type },
  { id: "cloud", label: "Settings", icon: CloudCog },
  { id: "sampling", label: "Sampling", icon: SlidersHorizontal },
  { id: "inputs", label: "Inputs", icon: Layers },
  { id: "framepack", label: "FramePack", icon: Film },
  { id: "output", label: "Output", icon: FileVideo },
] as const satisfies readonly SubTabItem[];

export type VideoSubTab = (typeof VIDEO_SUB_TABS)[number]["id"];

/** Sub-tabs of the Library in the Right Panel. */
export const LIBRARY_SUB_TABS = [
  { id: "saved", label: "Saved", icon: BookMarked, keywords: ["saved inputs", "sets", "frames"] },
  { id: "trash", label: "Trash", icon: Trash2, keywords: ["removed", "deleted", "restore", "bin"] },
] as const satisfies readonly SubTabItem[];

export type LibrarySubTab = (typeof LIBRARY_SUB_TABS)[number]["id"];

/** Sub-tabs of the Models panel. A selection is stored by id, so ids stay as they are. */
export const MODELS_SUB_TABS = [
  { id: "Current", label: "Current", icon: PackageCheck, keywords: ["loaded", "analyze"] },
  { id: "List", label: "List", icon: List, keywords: ["checkpoints", "all models"] },
  { id: "Audit", label: "Audit", icon: ShieldCheck, keywords: ["check", "issues", "fix"] },
  { id: "Metadata", label: "Metadata", icon: Tags, keywords: ["civitai", "previews", "sweep"] },
  { id: "Loader", label: "Loader", icon: FolderInput, keywords: ["components", "pipeline"] },
  { id: "Merge", label: "Merge", icon: Combine, keywords: ["combine", "blend", "checkpoint"] },
  { id: "Replace", label: "Replace", icon: Replace, keywords: ["swap", "substitute"] },
  { id: "CivitAI", label: "CivitAI", icon: CloudDownload, keywords: ["download", "browse"] },
  {
    id: "Huggingface",
    label: "Huggingface",
    icon: Globe,
    keywords: ["hugging face", "hf", "download", "browse"],
  },
  {
    id: "Extract LoRA",
    label: "Extract LoRA",
    icon: Scissors,
    keywords: ["lora extract", "distill", "low rank"],
  },
] as const satisfies readonly SubTabItem[];

export type ModelsSubTab = (typeof MODELS_SUB_TABS)[number]["id"];

/** Sub-tabs of the System panel. A selection is stored by id, so ids stay as they are. */
export const SYSTEM_SUB_TABS = [
  { id: "Overview", label: "Overview", icon: LayoutDashboard, keywords: ["status", "server"] },
  { id: "Storage", label: "Storage", icon: HardDrive, keywords: ["disk", "space", "folders"] },
  { id: "Update", label: "Update", icon: CircleArrowUp, keywords: ["upgrade", "version", "git"] },
  { id: "Activity", label: "Activity", icon: Activity, keywords: ["log", "requests"] },
  { id: "GPU Monitor", label: "GPU Monitor", icon: MemoryStick, keywords: ["vram", "temperature"] },
  { id: "System Info", label: "System Info", icon: Info, keywords: ["versions", "uptime"] },
  { id: "Benchmark", label: "Benchmark", icon: Timer, keywords: ["speed", "performance"] },
] as const satisfies readonly SubTabItem[];

export type SystemSubTab = (typeof SYSTEM_SUB_TABS)[number]["id"];

/** A Right Panel tab opened on one of its sub-tabs. */
export type RightSubTabTarget =
  | { rightTab: "library"; subTab: LibrarySubTab }
  | { rightTab: "models"; subTab: ModelsSubTab }
  | { rightTab: "system"; subTab: SystemSubTab };

/** Every Right Panel sub-tab, with the target that opens it. */
export const RIGHT_SUB_TABS: readonly { target: RightSubTabTarget; item: SubTabItem }[] = [
  ...LIBRARY_SUB_TABS.map((item) => ({
    target: { rightTab: "library" as const, subTab: item.id },
    item,
  })),
  ...MODELS_SUB_TABS.map((item) => ({
    target: { rightTab: "models" as const, subTab: item.id },
    item,
  })),
  ...SYSTEM_SUB_TABS.map((item) => ({
    target: { rightTab: "system" as const, subTab: item.id },
    item,
  })),
];

/** External links at the bottom of the Left Rail */
export const EXTERNAL_LINKS: ExternalLink[] = [
  { label: "Docs", icon: BookOpen, url: "https://vladmandic.github.io/sdnext-docs/" },
  { label: "GitHub", icon: GitBranch, url: "https://github.com/vladmandic/sdnext" },
  { label: "Discord", icon: MessageCircle, url: "https://discord.gg/VjvR2tabEX" },
  {
    label: "Contributors",
    icon: Users,
    url: "https://github.com/vladmandic/sdnext/graphs/contributors",
  },
];

export const DEFAULT_GENERATION_PARAMS = {
  prompt: "",
  negativePrompt: "",
  sampler: "Euler",
  steps: 20,
  width: 512,
  height: 512,
  batchSize: 1,
  batchCount: 1,
  cfgScale: 7,
  seed: -1,
  denoisingStrength: 0.5,
};

export const ZOOM_LIMITS = { min: 0.1, max: 16 };

export const RESIZE_MODES = ["None", "Fixed", "Crop", "Fill", "Outpaint", "Context aware"];

/** Hires fix size modes (Scale uses hr_resize_x/y=0, Fixed uses explicit dims) */
export const HIRES_SIZE_MODES = [
  { value: "scale", label: "Scale" },
  { value: "fixed", label: "Fixed" },
] as const;

/** Hires fix fit methods when using fixed dimensions (maps to hr_resize_mode) */
export const HIRES_FIT_MODES = [
  { value: "1", label: "Stretch" },
  { value: "2", label: "Crop" },
  { value: "3", label: "Fill" },
  { value: "4", label: "Outpaint" },
  { value: "5", label: "Context aware" },
] as const;

/** Context modes for context-aware hires resize */
export const HIRES_CONTEXT_MODES = [
  { value: "None", label: "None" },
  { value: "Add with forward", label: "Add with forward" },
  { value: "Remove with forward", label: "Remove with forward" },
  { value: "Add with backward", label: "Add with backward" },
  { value: "Remove with backward", label: "Remove with backward" },
] as const;
