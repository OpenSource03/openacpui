/**
 * PostHog analytics client for main process.
 *
 * Privacy-friendly analytics to track:
 * - Daily active users
 * - App version usage
 * - Basic feature usage (opt-in via settings)
 *
 * All events use an anonymous user ID generated at first run.
 * Users can disable analytics completely in settings.
 */

import { randomUUID } from "crypto";
import { app } from "electron";
import { getAppSettings, setAppSettings } from "./app-settings";
import { log } from "./logger";

// Lazy-loaded PostHog client
let PostHogCtor: typeof import("posthog-node").PostHog | null = null;
let client: import("posthog-node").PostHog | null = null;
let userId: string | null = null;
let lastDailyActiveCheck: string | null = null;

/**
 * Initialize PostHog client based on current settings.
 * Call this once at app startup, after settings are loaded.
 */
export async function initPostHog(): Promise<void> {
  const settings = getAppSettings();

  // Don't initialize if analytics is disabled
  if (!settings.analyticsEnabled) {
    return;
  }

  // Generate or load anonymous user ID
  userId = generateUserId();

  try {
    // PostHog project API keys are public (client-side) — safe to embed in source.
    // Override via POSTHOG_API_KEY env var if needed (e.g. for a fork's own project).
    const apiKey = process.env.POSTHOG_API_KEY || "phc_lOKFRov0SWy2R71BNJ2t978tmNYc3ND7WwueOteV5vw";
    if (!apiKey) {
      log("POSTHOG", "API key not configured — analytics disabled");
      return;
    }

    // Lazy-load posthog-node
    const posthogModule = await import("posthog-node");
    PostHogCtor = posthogModule.PostHog;

    // Initialize client with public PostHog project
    client = new PostHogCtor(apiKey, {
      host: "https://us.i.posthog.com",
      // Flush events every 10 seconds or 20 events, whichever comes first
      flushAt: 20,
      flushInterval: 10000,
    });

    log("POSTHOG", `Initialized (userId=${userId})`);

    // Track app start event
    await captureEvent("app_started", {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
    });

    // Track daily active user (once per day)
    await trackDailyActive();
  } catch (err) {
    // Non-fatal - analytics is optional
    log("POSTHOG", `Failed to initialize: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Generate or retrieve the anonymous user ID.
 * Stored in app settings for persistence across sessions.
 */
function generateUserId(): string {
  const settings = getAppSettings();

  // Use existing ID if present
  if (settings.analyticsUserId) {
    return settings.analyticsUserId;
  }

  // Generate new anonymous ID
  const newId = randomUUID();

  // Persist to settings
  setAppSettings({ analyticsUserId: newId });

  return newId;
}

/**
 * Track daily active user event (once per day).
 * Persists the last-sent date to settings to deduplicate across app restarts.
 */
async function trackDailyActive(): Promise<void> {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const settings = getAppSettings();

  // Skip if already tracked today (check both in-memory and persisted)
  if (lastDailyActiveCheck === today || settings.analyticsLastDailyActiveDate === today) {
    lastDailyActiveCheck = today;
    return;
  }

  lastDailyActiveCheck = today;
  setAppSettings({ analyticsLastDailyActiveDate: today });

  await captureEvent("daily_active_user", {
    date: today,
  });
}

/**
 * Capture a custom event with properties.
 */
export async function captureEvent(
  event: string,
  properties?: Record<string, unknown>
): Promise<void> {
  if (!client || !userId) return;

  try {
    client.capture({
      distinctId: userId,
      event,
      properties: {
        ...properties,
        // Always include version in all events
        app_version: app.getVersion(),
      },
    });
  } catch (err) {
    // Non-fatal - analytics should never break the app
    log("POSTHOG", `Failed to capture event: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Update user properties (for identifying user characteristics).
 */
export async function identifyUser(
  properties: Record<string, unknown>
): Promise<void> {
  if (!client || !userId) return;

  try {
    client.identify({
      distinctId: userId,
      properties,
    });
  } catch (err) {
    log("POSTHOG", `Failed to identify user: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Shutdown PostHog client (flush pending events, close connections).
 * Call this on app quit.
 */
export async function shutdownPostHog(): Promise<void> {
  if (!client) return;

  try {
    await client.shutdown();
    client = null;
  } catch (err) {
    log("POSTHOG", `Failed to shutdown: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Re-initialize PostHog when settings change.
 * Call this when user toggles analytics on/off.
 */
export async function reinitPostHog(): Promise<void> {
  // Shutdown existing client if any
  if (client) {
    await shutdownPostHog();
  }

  // Re-initialize if enabled
  await initPostHog();
}

/**
 * Check if analytics is currently enabled and initialized.
 */
export function isPostHogEnabled(): boolean {
  return client !== null;
}
