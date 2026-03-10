/**
 * Renderer-side analytics utility.
 *
 * Two channels:
 * - Custom events → IPC bridge to main process PostHog client (posthog-node)
 * - Exception capture → renderer-side posthog-js for rich stack traces
 *
 * Privacy: Never include file paths, prompt content, project names, API keys,
 * or any PII. Only pass anonymized metadata (engine type, tool name, counts, etc.).
 */

import { posthog } from "@/lib/posthog";

/** Fire-and-forget analytics event via the main process PostHog client. */
export function capture(event: string, properties?: Record<string, unknown>): void {
  try {
    window.claude.analytics?.capture(event, properties);
  } catch {
    // Analytics should never break the app
  }
}

/**
 * Capture an exception to PostHog error tracking.
 *
 * Uses the renderer-side posthog-js client so stack traces are captured
 * with full source context. Respects the user's analytics opt-in/out setting.
 */
export function captureException(error: Error, properties?: Record<string, unknown>): void {
  try {
    posthog.captureException(error, properties);
  } catch {
    // Analytics should never break the app
  }
}

/**
 * Log a warning to the console AND report the error to PostHog in one call.
 *
 * Renderer-side equivalent of the main process `reportError()` helper.
 * Use in catch blocks where the error should both be visible in devtools
 * and tracked in PostHog.
 *
 * @returns The extracted error message string (for use in UI state).
 */
export function reportError(
  label: string,
  err: unknown,
  context?: Record<string, unknown>,
): string {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${label}]`, err);

  const error = err instanceof Error ? err : new Error(message);
  captureException(error, { label, ...context });

  return message;
}
