type ShortcutInput = {
  type?: string;
  key?: string;
  control?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
};

/**
 * Matches the app's DevTools shortcuts from keyboard input events.
 * Scoped to window input handling so it never captures OS-global shortcuts.
 */
export function isDevToolsShortcut(input: ShortcutInput, platform: NodeJS.Platform): boolean {
  if (input.type !== "keyDown") return false;

  const key = (input.key ?? "").toLowerCase();
  if (key === "f12") return true;

  const commandOrControl = platform === "darwin" ? !!input.meta : !!input.control;
  if (!commandOrControl) return false;

  if (input.alt && key === "i") return true;
  if (input.shift && key === "j") return true;

  return false;
}
