/**
 * Shared error message extraction utility.
 *
 * Handles Error instances, structured objects with .message or .stderr,
 * strings, and unknown values. Used across all session IPC handlers.
 */

import { log } from "./logger";
import { captureException } from "./posthog";

export { extractErrorMessage } from "@shared/lib/error-utils";
import { extractErrorMessage } from "@shared/lib/error-utils";

/**
 * Log an error AND report it to PostHog exception tracking in one call.
 *
 * Replaces the common `log(label, extractErrorMessage(err))` pattern with
 * a single call that also captures the exception for error tracking.
 * Safe to call before PostHog is initialized (no-ops the capture).
 *
 * @returns The extracted error message string (for use in IPC responses).
 */
export function reportError(
  label: string,
  err: unknown,
  context?: Record<string, unknown>,
): string {
  const message = extractErrorMessage(err);
  log(label, message);

  const error = err instanceof Error ? err : new Error(message);
  captureException(error, { label, ...context });

  return message;
}
