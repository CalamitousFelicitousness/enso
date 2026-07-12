import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RightTab } from "@/lib/constants";

type NavView = "images" | "video" | "process" | "caption" | "gallery";
type ImagesSubTab =
  | "prompts"
  | "sampler"
  | "guidance"
  | "refine"
  | "detail"
  | "advanced"
  | "color"
  | "control"
  | "scripts";
type ColorMode = "dark" | "light" | "system";
type CanvasBackground = "dots" | "noise" | "iso";

type ModelsSubTab =
  | "Current"
  | "List"
  | "Audit"
  | "Metadata"
  | "Loader"
  | "Merge"
  | "Replace"
  | "CivitAI"
  | "Huggingface"
  | "Extract LoRA";

type SystemSubTab =
  "Overview" | "Storage" | "Update" | "Activity" | "GPU Monitor" | "System Info" | "Benchmark";

type CaptionSubTab = "vlm" | "openclip" | "tagger" | "cloud" | "default";

interface PanelSelections {
  modelsSubTab: ModelsSubTab;
  systemSubTab: SystemSubTab;
  captionSubTab: CaptionSubTab;
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
  rightPanelWidth: number;

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

  // Generation behavior
  livePreviews: boolean;

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
  dictKeepUnderscores: boolean;
  dictAppendComma: boolean;

  // Civitai browse preferences
  civitaiNsfw: boolean;
  civitaiFavorites: boolean;

  // Actions
  toggleLeftRail: () => void;
  setNavView: (view: NavView) => void;
  setImagesSubTab: (tab: ImagesSubTab) => void;
  toggleViewCollapsed: () => void;
  setResultThumbSize: (size: number) => void;
  setAutoFitFrame: (enabled: boolean) => void;
  setAutoUpdateProcessed: (enabled: boolean) => void;
  setAutoApplyModelDefaults: (enabled: boolean) => void;
  setLivePreviews: (enabled: boolean) => void;
  toggleLeftPanel: () => void;
  setLeftPanelWidth: (width: number) => void;
  toggleRightPanel: () => void;
  setRightPanelWidth: (width: number) => void;
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
  setDictKeepUnderscores: (enabled: boolean) => void;
  setDictAppendComma: (enabled: boolean) => void;
  setCivitaiNsfw: (enabled: boolean) => void;
  setCivitaiFavorites: (enabled: boolean) => void;
}

export type {
  NavView,
  ImagesSubTab,
  ColorMode,
  CanvasBackground,
  ModelsSubTab,
  SystemSubTab,
  CaptionSubTab,
  PanelSelections,
};

const DEFAULT_PANEL_SELECTIONS: PanelSelections = {
  modelsSubTab: "Current",
  systemSubTab: "Overview",
  captionSubTab: "vlm",
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
      rightPanelWidth: 420,
      activeRightTab: "networks",
      panelSelections: { ...DEFAULT_PANEL_SELECTIONS },
      resultThumbSize: 56,
      autoFitFrame: true,
      reprocessOnGenerate: true,
      autoApplyModelDefaults: false,
      livePreviews: true,
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
      dictKeepUnderscores: false,
      dictAppendComma: true,
      civitaiNsfw: false,
      civitaiFavorites: false,

      toggleLeftRail: () => set((s) => ({ leftRailCollapsed: !s.leftRailCollapsed })),
      setNavView: (view) => set({ activeNavView: view }),
      setImagesSubTab: (tab) => set({ activeImagesSubTab: tab }),
      toggleViewCollapsed: () => set((s) => ({ viewCollapsed: !s.viewCollapsed })),
      setResultThumbSize: (size) => set({ resultThumbSize: Math.max(40, Math.min(160, size)) }),
      setAutoFitFrame: (enabled) => set({ autoFitFrame: enabled }),
      setAutoUpdateProcessed: (enabled) => set({ reprocessOnGenerate: enabled }),
      setAutoApplyModelDefaults: (enabled) => set({ autoApplyModelDefaults: enabled }),
      setLivePreviews: (enabled) => set({ livePreviews: enabled }),
      toggleLeftPanel: () => set((s) => ({ leftPanelCollapsed: !s.leftPanelCollapsed })),
      setLeftPanelWidth: (width) => set({ leftPanelWidth: Math.max(280, Math.min(600, width)) }),
      toggleRightPanel: () => set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
      setRightPanelWidth: (width) => set({ rightPanelWidth: Math.max(280, Math.min(720, width)) }),
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
      addRecentCommand: (id) =>
        set((s) => {
          const filtered = s.recentCommandIds.filter((c) => c !== id);
          return { recentCommandIds: [id, ...filtered].slice(0, 5) };
        }),
      setQuickSettingsKeys: (keys) => set({ quickSettingsKeys: keys }),
      setPendingSettingsSearch: (query) => set({ pendingSettingsSearch: query }),
      setPromptAutocomplete: (enabled) => set({ promptAutocomplete: enabled }),
      setDictMinChars: (n) => set({ dictMinChars: Math.max(2, Math.min(6, n)) }),
      setDictKeepUnderscores: (enabled) => set({ dictKeepUnderscores: enabled }),
      setDictAppendComma: (enabled) => set({ dictAppendComma: enabled }),
      setCivitaiNsfw: (enabled) => set({ civitaiNsfw: enabled }),
      setCivitaiFavorites: (enabled) => set({ civitaiFavorites: enabled }),
    }),
    {
      name: "enso-ui",
      version: 5,
      partialize: (state) => {
        const {
          pendingSettingsSearch: _pending,
          dictMinChars: _mc,
          dictKeepUnderscores: _ku,
          dictAppendComma: _ac,
          ...rest
        } = state;
        return rest;
      },
    },
  ),
);
