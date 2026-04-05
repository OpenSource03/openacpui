import { useState, useCallback, useEffect, useRef } from "react";
import type { Space, SpaceColor } from "@/types";
import { capture } from "@/lib/analytics/analytics";

const ACTIVE_SPACE_KEY = "harnss-active-space";

// ── Color presets (shared with SpaceCustomizer) ──

export const SPACE_COLOR_PRESETS: SpaceColor[] = [
  { hue: 0, chroma: 0 },
  { hue: 15, chroma: 0.15 },
  { hue: 45, chroma: 0.15 },
  { hue: 85, chroma: 0.15 },
  { hue: 150, chroma: 0.15 },
  { hue: 200, chroma: 0.15 },
  { hue: 260, chroma: 0.15 },
  { hue: 300, chroma: 0.15 },
  { hue: 340, chroma: 0.15 },
];

export function useSpaceManager() {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [activeSpaceId, setActiveSpaceIdState] = useState<string>(() => {
    return localStorage.getItem(ACTIVE_SPACE_KEY) || "default";
  });

  useEffect(() => {
    window.claude.spaces.list().then(setSpaces);
  }, []);

  const setActiveSpaceId = useCallback((id: string) => {
    setActiveSpaceIdState(id);
    localStorage.setItem(ACTIVE_SPACE_KEY, id);
  }, []);

  // Debounce disk writes so slider drags don't spam IPC, while updating React state immediately
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const persistSpaces = useCallback(async (next: Space[], immediate = false) => {
    setSpaces(next);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (immediate) {
      await window.claude.spaces.save(next);
    } else {
      saveTimerRef.current = setTimeout(() => {
        void window.claude.spaces.save(next);
      }, 150);
    }
  }, []);

  const createSpace = useCallback(
    async (name: string, icon: string, iconType: "emoji" | "lucide", color: SpaceColor) => {
      const space: Space = {
        id: crypto.randomUUID(),
        name,
        icon,
        iconType,
        color,
        createdAt: Date.now(),
        order: spaces.length,
      };
      await persistSpaces([...spaces, space], true);
      capture("space_created", { has_color: !!color, icon_type: iconType });
      return space;
    },
    [spaces, persistSpaces],
  );

  const updateSpace = useCallback(
    async (id: string, updates: Partial<Pick<Space, "name" | "icon" | "iconType" | "color">>) => {
      const next = spaces.map((s) => (s.id === id ? { ...s, ...updates } : s));
      await persistSpaces(next);
    },
    [spaces, persistSpaces],
  );

  const deleteSpace = useCallback(
    async (id: string) => {
      if (id === "default") return;
      const next = spaces.filter((s) => s.id !== id);
      await persistSpaces(next, true);
      if (activeSpaceId === id) {
        setActiveSpaceId("default");
      }
      return id; // Return deleted ID so caller can reassign projects
    },
    [spaces, persistSpaces, activeSpaceId, setActiveSpaceId],
  );

  const reorderSpaces = useCallback(
    async (orderedIds: string[]) => {
      const next = orderedIds
        .map((id, i) => {
          const s = spaces.find((sp) => sp.id === id);
          return s ? { ...s, order: i } : null;
        })
        .filter((s): s is Space => s !== null);
      await persistSpaces(next, true);
    },
    [spaces, persistSpaces],
  );

  const activeSpace = spaces.find((s) => s.id === activeSpaceId) || spaces[0];

  return {
    spaces,
    activeSpaceId,
    activeSpace,
    setActiveSpaceId,
    createSpace,
    updateSpace,
    deleteSpace,
    reorderSpaces,
  };
}
