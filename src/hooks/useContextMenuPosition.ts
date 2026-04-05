import { useState, useCallback, useRef, type RefObject, type CSSProperties } from "react";

/** Return type for the shared context-menu positioning hook. */
export interface ContextMenuState {
  /** Whether the dropdown menu is currently open. */
  menuOpen: boolean;
  /** Radix align value — "start" for right-click, "end" for button click. */
  menuAlign: "start" | "end";
  /** Coordinates of the invisible trigger element, relative to the container ref. */
  menuPos: { x: number; y: number };
  /** Pass to `DropdownMenu onOpenChange`. */
  setMenuOpen: (open: boolean) => void;
  /** Attach to the container element via `onContextMenu`. */
  handleContextMenu: (e: React.MouseEvent) => void;
  /** Attach to the "..." button via `onClick`. */
  handleMenuButtonClick: (e: React.MouseEvent) => void;
  /** Inline style for the invisible trigger `<span>`. */
  triggerStyle: CSSProperties;
  /** Ref to attach to the positioning container element. */
  containerRef: RefObject<HTMLDivElement | null>;
}

/**
 * Shared hook for positioning a Radix `DropdownMenu` from either a right-click
 * or a button click. Returns all state, handlers, and the invisible trigger style
 * needed to wire up the menu.
 *
 * **Right-click** places the trigger at the cursor position (align "start").
 * **Button click** places the trigger at the button's bottom-right corner (align "end").
 *
 * Both positions are computed relative to a container ref so the absolute
 * trigger `<span>` lands in the correct spot.
 */
export function useContextMenuPosition(): ContextMenuState {
  const containerRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAlign, setMenuAlign] = useState<"start" | "end">("end");
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    setMenuPos({
      x: rect ? e.clientX - rect.left : 0,
      y: rect ? e.clientY - rect.top : 0,
    });
    setMenuAlign("start");
    setMenuOpen(true);
  }, []);

  const handleMenuButtonClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    const buttonRect = e.currentTarget.getBoundingClientRect();
    setMenuPos({
      x: rect ? buttonRect.right - rect.left : 0,
      y: rect ? buttonRect.bottom - rect.top : 0,
    });
    setMenuAlign("end");
    setMenuOpen(true);
  }, []);

  const triggerStyle: CSSProperties = {
    position: "absolute",
    left: menuPos.x,
    top: menuPos.y,
    width: 0,
    height: 0,
    pointerEvents: "none",
  };

  return {
    menuOpen,
    menuAlign,
    menuPos,
    setMenuOpen,
    handleContextMenu,
    handleMenuButtonClick,
    triggerStyle,
    containerRef,
  };
}
