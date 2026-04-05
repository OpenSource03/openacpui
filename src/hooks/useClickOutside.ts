import { useEffect, type RefObject } from "react";

/**
 * Calls `onClickOutside` when a mousedown or touchstart event occurs outside
 * the element referenced by `ref`. Pass `enabled: false` to skip attaching
 * listeners (useful for conditionally-open dropdowns).
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onClickOutside: () => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClickOutside();
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [ref, onClickOutside, enabled]);
}
