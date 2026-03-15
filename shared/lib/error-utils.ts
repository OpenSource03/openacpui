/**
 * Pure error message extraction — no platform-specific dependencies.
 *
 * Handles Error instances, structured objects with .message,
 * plain strings, and unknown values. Each platform wraps this
 * with its own `reportError` (PostHog in electron, file logger in CLI).
 */

export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}
