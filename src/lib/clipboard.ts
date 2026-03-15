import { reportError } from "@/lib/analytics";

/**
 * Last-resort clipboard write via a hidden textarea and `execCommand("copy")`.
 * Only reached if both the Electron IPC bridge and `navigator.clipboard` are
 * unavailable — effectively dead code in the normal Electron runtime.
 */
function fallbackCopy(value: string): boolean {
  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, value.length);

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

/**
 * Writes text to the clipboard using a 3-tier strategy:
 * 1. Electron IPC bridge (`window.claude.writeClipboardText`)
 * 2. `navigator.clipboard.writeText`
 * 3. `document.execCommand("copy")` fallback
 *
 * Returns `true` on success, `false` on failure (errors are reported via PostHog).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const bridge = window.claude?.writeClipboardText;
    if (bridge) {
      const result = await bridge(text);
      if (result?.ok === false) {
        throw new Error(result.error ?? "Clipboard write failed");
      }
      return true;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    if (fallbackCopy(text)) return true;

    throw new Error("Clipboard API unavailable");
  } catch (err) {
    if (fallbackCopy(text)) return true;
    reportError("COPY_TO_CLIPBOARD", err);
    return false;
  }
}
