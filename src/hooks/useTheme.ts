import { useEffect, useState } from "react";
import type { ThemeOption } from "@/types";

export type ResolvedTheme = "light" | "dark";

function resolveTheme(option: ThemeOption): ResolvedTheme {
  if (option === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return option;
}

/**
 * Resolves a ThemeOption ("light" | "dark" | "system") to an effective theme,
 * applies the `dark` CSS class on <html>, and listens for OS preference changes
 * when in "system" mode.
 */
export function useTheme(theme: ThemeOption): ResolvedTheme {
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(theme));

  // Re-resolve when the setting changes
  useEffect(() => {
    setResolved(resolveTheme(theme));
  }, [theme]);

  // Listen for OS preference changes when in "system" mode
  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setResolved(e.matches ? "dark" : "light");
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [theme]);

  // Apply the dark class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (resolved === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [resolved]);

  return resolved;
}
