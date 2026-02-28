import { useEffect, useState } from "react";

export type ResolvedThemeClass = "light" | "dark";

function readThemeClass(): ResolvedThemeClass {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * Reads the effective theme from <html class="dark"> and stays in sync when
 * the class toggles at runtime.
 */
export function useResolvedThemeClass(): ResolvedThemeClass {
  const [theme, setTheme] = useState<ResolvedThemeClass>(() => readThemeClass());

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setTheme(readThemeClass());
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}
