/**
 * Renderer-side analytics utility.
 *
 * Thin wrapper around the IPC bridge to the main process PostHog client.
 * All event data flows through the main process — no PostHog SDK in the renderer.
 *
 * Privacy: Never include file paths, prompt content, project names, API keys,
 * or any PII. Only pass anonymized metadata (engine type, tool name, counts, etc.).
 */

/** Fire-and-forget analytics event via the main process PostHog client. */
export function capture(event: string, properties?: Record<string, unknown>): void {
  try {
    window.claude.analytics?.capture(event, properties);
  } catch {
    // Analytics should never break the app
  }
}
