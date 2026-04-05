import { useReducer, useCallback, useEffect, type RefObject } from "react";
import type { Annotation } from "@/lib/chat/annotation-types";

// Cap history at 50 entries to prevent memory bloat with large freehand paths
const MAX_HISTORY = 50;

interface HistoryState {
  past: Annotation[][];
  present: Annotation[];
  future: Annotation[][];
}

type HistoryAction =
  | { type: "push"; annotations: Annotation[] }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "clear" };

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "push": {
      const newPast = [...state.past, state.present].slice(-MAX_HISTORY);
      return { past: newPast, present: action.annotations, future: [] };
    }
    case "undo": {
      if (state.past.length === 0) return state;
      const prev = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        present: prev,
        future: [state.present, ...state.future],
      };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
      };
    }
    case "clear":
      return { past: [], present: [], future: [] };
    default:
      return state;
  }
}

export interface UseAnnotationHistoryReturn {
  annotations: Annotation[];
  pushState: (next: Annotation[]) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  clear: () => void;
}

/**
 * Manages undo/redo history for annotation shapes.
 * Optionally binds Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z keyboard
 * shortcuts scoped to a container ref (prevents bubbling to app).
 */
export function useAnnotationHistory(
  containerRef?: RefObject<HTMLElement | null>,
): UseAnnotationHistoryReturn {
  const [state, dispatch] = useReducer(historyReducer, {
    past: [],
    present: [],
    future: [],
  });

  const pushState = useCallback((next: Annotation[]) => {
    dispatch({ type: "push", annotations: next });
  }, []);

  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const clear = useCallback(() => dispatch({ type: "clear" }), []);

  // Keyboard shortcuts scoped to the container element
  useEffect(() => {
    const el = containerRef?.current;
    if (!el) return;

    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== "z") return;

      e.preventDefault();
      e.stopPropagation();

      if (e.shiftKey) {
        dispatch({ type: "redo" });
      } else {
        dispatch({ type: "undo" });
      }
    }

    el.addEventListener("keydown", handleKeyDown);
    return () => el.removeEventListener("keydown", handleKeyDown);
  }, [containerRef]);

  return {
    annotations: state.present,
    pushState,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    clear,
  };
}
