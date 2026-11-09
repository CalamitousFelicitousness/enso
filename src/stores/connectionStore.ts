import { create } from "zustand";
import { LOCAL } from "@/lib/profile/names";
import { persistLocal } from "@/profile/local";

interface ConnectionState {
  /** Empty string means use window.location.origin (default) */
  backendUrl: string;
  username: string;
  password: string;
  setBackendUrl: (url: string) => void;
  setAuth: (username: string, password: string) => void;
  reset: () => void;
}

export const useConnectionStore = create<ConnectionState>()(
  persistLocal(
    (set) => ({
      backendUrl: "",
      username: "",
      password: "",

      setBackendUrl: (url) => set({ backendUrl: url }),
      setAuth: (username, password) => set({ username, password }),
      reset: () => set({ backendUrl: "", username: "", password: "" }),
    }),
    { name: LOCAL.connections },
  ),
);
