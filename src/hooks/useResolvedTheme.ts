import { useSyncExternalStore } from "react";
import { useUiStore } from "@/stores/uiStore";

function getSystemDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function subscribeSystemTheme(cb: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function useResolvedTheme(): "dark" | "light" {
  const colorMode = useUiStore((s) => s.colorMode);
  const systemDark = useSyncExternalStore(subscribeSystemTheme, getSystemDark);
  if (colorMode === "system") return systemDark ? "dark" : "light";
  return colorMode;
}
