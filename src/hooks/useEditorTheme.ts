import { useCallback, useEffect, useRef, useState } from "react";
import { loader } from "@monaco-editor/react";
import { BUILTIN_THEMES, applyThemeUI, clearThemeUI, getMonacoThemeName } from "@/lib/themes";

const STORAGE_KEY = "harnss-editor-theme";

let monacoThemesRegistered = false;

async function getMonaco() {
  return loader.init();
}

function registerAllThemes(monaco: Awaited<ReturnType<typeof getMonaco>>): void {
  if (monacoThemesRegistered) return;
  for (const theme of BUILTIN_THEMES) {
    if (theme.id === "default-dark") continue;
    monaco.editor.defineTheme(getMonacoThemeName(theme.id), {
      base: theme.monaco.base,
      inherit: true,
      rules: theme.monaco.rules,
      colors: theme.monaco.colors,
    });
  }
  monacoThemesRegistered = true;
}

export function useEditorTheme() {
  const [currentThemeId, setCurrentThemeId] = useState(() => localStorage.getItem(STORAGE_KEY) || "default-dark");
  const initRef = useRef(false);

  const applyTheme = useCallback((themeId: string) => {
    const theme = BUILTIN_THEMES.find((t) => t.id === themeId);
    if (!theme) return;

    setCurrentThemeId(themeId);
    localStorage.setItem(STORAGE_KEY, themeId);

    if (themeId === "default-dark") {
      clearThemeUI();
    } else {
      applyThemeUI(theme);
    }

    getMonaco().then((monaco) => {
      registerAllThemes(monaco);
      monaco.editor.setTheme(themeId === "default-dark" ? "vs-dark" : getMonacoThemeName(themeId));
    });
  }, []);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const savedId = localStorage.getItem(STORAGE_KEY) || "default-dark";
    if (savedId !== "default-dark") {
      applyTheme(savedId);
    } else {
      getMonaco().then((monaco) => registerAllThemes(monaco));
    }
  }, [applyTheme]);

  return {
    currentThemeId,
    setTheme: applyTheme,
    themes: BUILTIN_THEMES,
    monacoTheme: currentThemeId === "default-dark" ? "vs-dark" : getMonacoThemeName(currentThemeId),
  };
}

export function getMonacoThemeForEditor(): string {
  const id = localStorage.getItem(STORAGE_KEY) || "default-dark";
  if (id === "default-dark") return "vs-dark";
  return getMonacoThemeName(id);
}
