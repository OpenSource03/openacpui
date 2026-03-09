import { useState, useCallback, useEffect } from "react";
import type { Space, SpaceColor } from "@/types";
import { capture } from "@/lib/analytics";

const ACTIVE_SPACE_KEY = "harnss-active-space";

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

  const persistSpaces = useCallback(async (next: Space[]) => {
    setSpaces(next);
    await window.claude.spaces.save(next);
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
      await persistSpaces([...spaces, space]);
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
      if (id === "default") return; // Can't delete default
      const next = spaces.filter((s) => s.id !== id);
      await persistSpaces(next);
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
      await persistSpaces(next);
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
