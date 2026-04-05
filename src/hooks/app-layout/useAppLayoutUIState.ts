import { useCallback, useEffect, useState } from "react";
import type { GrabbedElement } from "@/types";
import { WELCOME_COMPLETED_KEY } from "@/components/welcome/shared";

interface UseAppLayoutUIStateInput {
  isNativeGlass: boolean;
  onHideSettings: () => void;
}

export function useAppLayoutUIState(input: UseAppLayoutUIStateInput) {
  const [windowFocused, setWindowFocused] = useState(true);
  const [welcomeCompleted, setWelcomeCompleted] = useState(
    () => localStorage.getItem(WELCOME_COMPLETED_KEY) === "true",
  );
  const [grabbedElements, setGrabbedElements] = useState<GrabbedElement[]>([]);
  const [previewFile, setPreviewFile] = useState<{ path: string; sourceRect: DOMRect } | null>(null);

  useEffect(() => {
    if (!input.isNativeGlass) return;
    const onFocus = () => setWindowFocused(true);
    const onBlur = () => setWindowFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, [input.isNativeGlass]);

  const handleWelcomeComplete = useCallback(() => {
    localStorage.setItem(WELCOME_COMPLETED_KEY, "true");
    setWelcomeCompleted(true);
  }, []);

  const handleReplayWelcome = useCallback(() => {
    localStorage.removeItem(WELCOME_COMPLETED_KEY);
    setWelcomeCompleted(false);
    input.onHideSettings();
  }, [input]);

  const handleElementGrab = useCallback((element: GrabbedElement) => {
    setGrabbedElements((prev) => [...prev, element]);
  }, []);

  const handleRemoveGrabbedElement = useCallback((id: string) => {
    setGrabbedElements((prev) => prev.filter((element) => element.id !== id));
  }, []);

  const clearGrabbedElements = useCallback(() => {
    setGrabbedElements([]);
  }, []);

  const handlePreviewFile = useCallback((filePath: string, sourceRect: DOMRect) => {
    setPreviewFile({ path: filePath, sourceRect });
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewFile(null);
  }, []);

  return {
    windowFocused,
    welcomeCompleted,
    handleWelcomeComplete,
    handleReplayWelcome,
    grabbedElements,
    clearGrabbedElements,
    handleElementGrab,
    handleRemoveGrabbedElement,
    previewFile,
    handlePreviewFile,
    handleClosePreview,
  };
}
