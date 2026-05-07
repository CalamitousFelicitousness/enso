import { create } from "zustand";

export interface BackendStatus {
  status: string;
  task: string;
  textinfo: string | null;
  current: string;
  step: number;
  steps: number;
  progress: number;
  eta: number | null;
  elapsed: number | null;
  uptime: number;
  connected: boolean;
  previewUrl: string | null;
}

interface BackendStatusState extends BackendStatus {
  setStatus: (data: Partial<BackendStatus>) => void;
  setPreview: (url: string) => void;
  setConnected: (connected: boolean) => void;
  reset: () => void;
}

const IDLE: BackendStatus = {
  status: "idle",
  task: "",
  textinfo: null,
  current: "",
  step: 0,
  steps: 0,
  progress: 0,
  eta: null,
  elapsed: null,
  uptime: 0,
  connected: false,
  previewUrl: null,
};

export const useBackendStatusStore = create<BackendStatusState>()((set) => ({
  ...IDLE,

  setStatus: (data) =>
    set((state) => ({
      status: data.status ?? state.status,
      task: data.task ?? state.task,
      textinfo: data.textinfo ?? null,
      current: data.current ?? state.current,
      step: data.step ?? state.step,
      steps: data.steps ?? state.steps,
      progress: data.progress ?? state.progress,
      eta: data.eta ?? null,
      elapsed: data.elapsed ?? null,
      uptime: data.uptime ?? state.uptime,
    })),

  setPreview: (url) =>
    set((state) => {
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      return { previewUrl: url };
    }),

  setConnected: (connected) => set({ connected }),

  reset: () =>
    set((state) => {
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      return { ...IDLE, connected: state.connected };
    }),
}));
