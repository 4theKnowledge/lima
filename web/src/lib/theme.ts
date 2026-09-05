/**
 * Theme system. Applies a `data-theme` attribute on <html> that CSS custom
 * properties in index.css read from. "auto" follows OS `prefers-color-scheme`.
 *
 * Kept separate from settings.ts so the effect + media-query wiring doesn't
 * live in the store file.
 */

import { useEffect } from "react";

import type { Theme } from "../settings";
import { useSettings } from "../settings";

function resolveTheme(t: Theme): "dark" | "light" {
  if (t === "auto") {
    return typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return t;
}

export function useApplyTheme(): void {
  const { theme } = useSettings();
  useEffect(() => {
    const apply = () =>
      document.documentElement.setAttribute("data-theme", resolveTheme(theme));
    apply();
    if (theme !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}
