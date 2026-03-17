import { useState, useEffect, useMemo, useCallback, useSyncExternalStore } from "react";
import { contrastText } from "@/lib/utils";

type ColorMode = "dark" | "light" | "system";

function getSystemDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function subscribeSystemTheme(cb: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function usePlaygroundTheme() {
  const [colorMode, setColorMode] = useState<ColorMode>("dark");
  const [accentColor, setAccentColor] = useState("#00bcd4");
  const [uiScale, setUiScaleRaw] = useState(18);

  const setUiScale = useCallback(
    (scale: number) => setUiScaleRaw(Math.max(8, Math.min(28, scale))),
    [],
  );

  // Resolve "system" to actual theme
  const systemDark = useSyncExternalStore(subscribeSystemTheme, getSystemDark);
  const resolvedTheme = colorMode === "system" ? (systemDark ? "dark" : "light") : colorMode;

  // Color mode — set/remove data-theme on <html>
  useEffect(() => {
    if (resolvedTheme === "light") {
      document.documentElement.dataset.theme = "light";
    } else {
      delete document.documentElement.dataset.theme;
    }
    return () => { delete document.documentElement.dataset.theme; };
  }, [resolvedTheme]);

  // Accent color — set CSS custom properties
  const accentProps = useMemo(() => {
    const fg = contrastText(accentColor);
    return {
      "--primary": accentColor,
      "--primary-foreground": fg,
      "--ring": accentColor,
      "--rail-primary": accentColor,
      "--rail-primary-foreground": fg,
      "--rail-ring": accentColor,
      "--chart-1": accentColor,
    } as Record<string, string>;
  }, [accentColor]);

  useEffect(() => {
    const el = document.documentElement;
    for (const [prop, val] of Object.entries(accentProps)) {
      el.style.setProperty(prop, val);
    }
    return () => {
      for (const prop of Object.keys(accentProps)) {
        el.style.removeProperty(prop);
      }
    };
  }, [accentProps]);

  // UI scale — set root font size
  useEffect(() => {
    document.documentElement.style.fontSize = `${uiScale}px`;
    return () => { document.documentElement.style.fontSize = ""; };
  }, [uiScale]);

  return {
    colorMode, setColorMode,
    accentColor, setAccentColor,
    uiScale, setUiScale,
    resolvedTheme,
  };
}
