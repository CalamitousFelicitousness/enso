import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RightTab } from "@/lib/constants";

type NavView = "images" | "video" | "process" | "caption" | "gallery";
type ImagesSubTab = "prompts" | "sampler" | "guidance" | "refine" | "detail" | "advanced" | "color" | "control" | "scripts";
type ColorMode = "dark" | "light" | "system";
type CanvasBackground = "dots" | "noise" | "iso";

type ModelsSubTab =
  | "Current"
  | "List"
  | "Metadata"
  | "Loader"
  | "Merge"
  | "Replace"
  | "CivitAI"
  | "Huggingface"
  | "Extract LoRA";

type SystemSubTab =
  | "Overview"
  | "Storage"
  | "Update"
  | "Activity"
  | "GPU Monitor"
  | "System Info"
  | "Benchmark";

type CaptionSubTab = "vlm" | "openclip" | "tagger" | "default";
type VideoSubTab = "models" | "framepack" | "ltx";

interface PanelSelections {
  modelsSubTab: ModelsSubTab;
  systemSubTab: SystemSubTab;
  captionSubTab: CaptionSubTab;
  videoSubTab: VideoSubTab;
  /** Free-form because backend Settings sections are dynamic. The synthetic
   * Connection / Appearance ids and any backend section id are valid; null
   * falls back to whichever section SettingsView resolves first. */
  settingsSection: string | null;
}

interface UiState {
  // Left Rail
  leftRailCollapsed: boolean;
  activeNavView: NavView;
  activeImagesSubTab: ImagesSubTab;
  viewCollapsed: boolean;

  // Panels
  leftPanelCollapsed: boolean;
  leftPanelWidth: number;
  rightPanelCollapsed: boolean;

  // Right tabs
  activeRightTab: RightTab;

  // Sub-tab routing for parent panels
  panelSelections: PanelSelections;

  // Result gallery
  resultThumbSize: number;

  // Canvas preferences
  autoFitFrame: boolean;
  reprocessOnGenerate: boolean;

  // Model defaults
  autoApplyModelDefaults: boolean;

  // Command palette
  recentCommandIds: string[];

  // Settings search
  pendingSettingsSearch: string | null;

  // Quick settings customization
  quickSettingsKeys: string[] | null;

  // Appearance
  colorMode: ColorMode;
  accentColor: string;
  uiScale: number;
  canvasLabelScale: number;
  canvasBackground: CanvasBackground;

  // Prompt autocomplete
  promptAutocomplete: boolean;
  dictMinChars: number;
  dictReplaceUnderscores: boolean;
  dictAppendComma: boolean;

  // Actions
  toggleLeftRail: () => void;
  setNavView: (view: NavView) => void;
  setImagesSubTab: (tab: ImagesSubTab) => void;
  toggleViewCollapsed: () => void;
  setResultThumbSize: (size: number) => void;
  setAutoFitFrame: (enabled: boolean) => void;
  setAutoUpdateProcessed: (enabled: boolean) => void;
  setAutoApplyModelDefaults: (enabled: boolean) => void;
  toggleLeftPanel: () => void;
  setLeftPanelWidth: (width: number) => void;
  toggleRightPanel: () => void;
  setRightTab: (tab: RightTab) => void;
  openRightTab: (tab: RightTab) => void;
  setPanelSelection: <K extends keyof PanelSelections>(key: K, value: PanelSelections[K]) => void;
  setColorMode: (mode: ColorMode) => void;
  setAccentColor: (color: string) => void;
  setUiScale: (scale: number) => void;
  setCanvasLabelScale: (scale: number) => void;
  setCanvasBackground: (bg: CanvasBackground) => void;
  addRecentCommand: (id: string) => void;
  setQuickSettingsKeys: (keys: string[] | null) => void;
  setPendingSettingsSearch: (query: string | null) => void;
  setPromptAutocomplete: (enabled: boolean) => void;
  setDictMinChars: (n: number) => void;
  setDictReplaceUnderscores: (enabled: boolean) => void;
  setDictAppendComma: (enabled: boolean) => void;
}

export type { NavView, ImagesSubTab, ColorMode, CanvasBackground, ModelsSubTab, SystemSubTab, CaptionSubTab, VideoSubTab, PanelSelections };

const DEFAULT_PANEL_SELECTIONS: PanelSelections = {
  modelsSubTab: "Current",
  systemSubTab: "Overview",
  captionSubTab: "vlm",
  videoSubTab: "models",
  settingsSection: null,
};

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      leftRailCollapsed: false,
      activeNavView: "images",
      activeImagesSubTab: "prompts",
      viewCollapsed: false,
      leftPanelCollapsed: false,
      leftPanelWidth: 380,
      rightPanelCollapsed: true,
      activeRightTab: "networks",
      panelSelections: { ...DEFAULT_PANEL_SELECTIONS },
      resultThumbSize: 56,
      autoFitFrame: true,
      reprocessOnGenerate: true,
      autoApplyModelDefaults: false,
      recentCommandIds: [],
      pendingSettingsSearch: null,
      quickSettingsKeys: null,
      colorMode: "dark",
      accentColor: "#00bcd4",
      uiScale: 18,
      canvasLabelScale: 1,
      canvasBackground: "dots",
      promptAutocomplete: true,
      dictMinChars: 3,
      dictReplaceUnderscores: true,
      dictAppendComma: true,

      toggleLeftRail: () => set((s) => ({ leftRailCollapsed: !s.leftRailCollapsed })),
      setNavView: (view) => set({ activeNavView: view }),
      setImagesSubTab: (tab) => set({ activeImagesSubTab: tab }),
      toggleViewCollapsed: () => set((s) => ({ viewCollapsed: !s.viewCollapsed })),
      setResultThumbSize: (size) => set({ resultThumbSize: Math.max(40, Math.min(160, size)) }),
      setAutoFitFrame: (enabled) => set({ autoFitFrame: enabled }),
      setAutoUpdateProcessed: (enabled) => set({ reprocessOnGenerate: enabled }),
      setAutoApplyModelDefaults: (enabled) => set({ autoApplyModelDefaults: enabled }),
      toggleLeftPanel: () => set((s) => ({ leftPanelCollapsed: !s.leftPanelCollapsed })),
      setLeftPanelWidth: (width) => set({ leftPanelWidth: Math.max(280, Math.min(600, width)) }),
      toggleRightPanel: () => set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
      setRightTab: (tab) => set({ activeRightTab: tab }),
      openRightTab: (tab) => set({ activeRightTab: tab, rightPanelCollapsed: false }),
      setPanelSelection: (key, value) =>
        set((s) => ({
          panelSelections: { ...s.panelSelections, [key]: value },
        })),
      setColorMode: (mode) => set({ colorMode: mode }),
      setAccentColor: (color) => set({ accentColor: color }),
      setUiScale: (scale) => set({ uiScale: Math.max(8, Math.min(28, scale)) }),
      setCanvasLabelScale: (scale) => set({ canvasLabelScale: Math.max(0.5, Math.min(2, scale)) }),
      setCanvasBackground: (bg) => set({ canvasBackground: bg }),
      addRecentCommand: (id) => set((s) => {
        const filtered = s.recentCommandIds.filter((c) => c !== id);
        return { recentCommandIds: [id, ...filtered].slice(0, 5) };
      }),
      setQuickSettingsKeys: (keys) => set({ quickSettingsKeys: keys }),
      setPendingSettingsSearch: (query) => set({ pendingSettingsSearch: query }),
      setPromptAutocomplete: (enabled) => set({ promptAutocomplete: enabled }),
      setDictMinChars: (n) => set({ dictMinChars: Math.max(2, Math.min(6, n)) }),
      setDictReplaceUnderscores: (enabled) => set({ dictReplaceUnderscores: enabled }),
      setDictAppendComma: (enabled) => set({ dictAppendComma: enabled }),
    }),
    {
      name: "enso-ui",
      version: 3,
      migrate: (persisted, version) => {
        if (!persisted || typeof persisted !== "object") return persisted;
        const p = persisted as Record<string, unknown>;
        if (version < 3 && !("panelSelections" in p)) {
          p.panelSelections = { ...DEFAULT_PANEL_SELECTIONS };
        }
        return p;
      },
      partialize: (state) => {
        const { pendingSettingsSearch: _pending, dictMinChars: _mc, dictReplaceUnderscores: _ru, dictAppendComma: _ac, ...rest } = state;
        return rest;
      },
    },
  ),
);
