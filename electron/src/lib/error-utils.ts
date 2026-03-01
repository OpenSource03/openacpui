/**
 * Shared error message extraction utility.
 *
 * Handles Error instances, structured objects with .message or .stderr,
 * strings, and unknown values. Used across all session IPC handlers.
 */
export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    // Fallback: JSON stringify structured errors (e.g., JSON-RPC error objects)
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}
