/**
 * Manages the horizontal resize handle between the chat pane and the
 * main workspace tool area.
 *
 * Same pattern as `useBottomHeightResize` — encapsulates the manual
 * mousemove/mouseup listener pattern that was previously a 50-line
 * `handleMainToolAreaResizeStart` useCallback in AppLayout.
 */

import { useCallback, useState } from "react";
import type { MainToolWorkspaceState } from "@/hooks/useMainToolWorkspace";
import { resolveMainToolAreaLeadingColumnResize } from "@/lib/workspace/main-tool-widths";

export interface UseMainToolAreaResizeInput {
  mainToolWorkspace: MainToolWorkspaceState;
  mainTopToolColumnCount: number;
  mainCombinedWorkspaceWidth: number;
  mainToolRelativeFractions: number[];
  mainWorkspaceChatMinWidth: number;
  mainToolAreaWidth: number;
  outerHandleWidth: number;
}

export interface UseMainToolAreaResizeReturn {
  isResizing: boolean;
  handleResizeStart: (event: React.MouseEvent) => void;
}

export function useMainToolAreaResize(
  input: UseMainToolAreaResizeInput,
): UseMainToolAreaResizeReturn {
  const {
    mainToolWorkspace,
    mainTopToolColumnCount,
    mainCombinedWorkspaceWidth,
    mainToolRelativeFractions,
    mainWorkspaceChatMinWidth,
    mainToolAreaWidth,
    outerHandleWidth,
  } = input;

  const [isResizing, setIsResizing] = useState(false);

  const handleResizeStart = useCallback(
    (event: React.MouseEvent) => {
      if (mainTopToolColumnCount <= 0 || mainCombinedWorkspaceWidth <= 0) return;

      event.preventDefault();
      setIsResizing(true);
      const startX = event.clientX;
      const startToolAreaWidth = mainToolAreaWidth;

      const handleMove = (moveEvent: MouseEvent) => {
        const deltaPx = startX - moveEvent.clientX;
        const nextLayout = resolveMainToolAreaLeadingColumnResize({
          startToolAreaWidth,
          desiredToolAreaWidth: startToolAreaWidth + deltaPx,
          workspaceWidth: mainCombinedWorkspaceWidth,
          minChatWidth: mainWorkspaceChatMinWidth,
          toolRelativeFractions: mainToolRelativeFractions,
          outerHandleWidth,
        });
        mainToolWorkspace.setWidthFractionsDirect(nextLayout.widthFractions);
        mainToolWorkspace.setPreferredTopAreaWidthPx(nextLayout.preferredTopAreaWidthPx);
      };

      const handleUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };

      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [
      mainCombinedWorkspaceWidth,
      mainToolRelativeFractions,
      mainToolAreaWidth,
      mainToolWorkspace,
      mainTopToolColumnCount,
      mainWorkspaceChatMinWidth,
      outerHandleWidth,
    ],
  );

  return { isResizing, handleResizeStart };
}
