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

// Lazy-loaded PostHog client (ESM package)
let PostHog: typeof import("posthog-node").default | null = null;
let client: InstanceType<typeof import("posthog-node").default> | null = null;
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
    // Lazy-load posthog-node (ESM package)
    const posthogModule = await import("posthog-node");
    PostHog = posthogModule.default;

    // Initialize client with public PostHog project
    client = new PostHog(
      // This is a placeholder - replace with actual PostHog project API key
      // Or load from env var: process.env.POSTHOG_API_KEY
      "phc_placeholder_key_replace_with_real_key",
      {
        host: "https://us.i.posthog.com",
        // Flush events every 10 seconds or 20 events, whichever comes first
        flushAt: 20,
        flushInterval: 10000,
      }
    );

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
    console.warn("Failed to initialize PostHog:", err);
  }
}

/**
 * Generate or retrieve the anonymous user ID.
 * Stored in app settings for persistence across sessions.
 */
function generateUserId(): string {
  const settings = getAppSettings();

  // Use existing ID if present
  if ((settings as any).analyticsUserId) {
    return (settings as any).analyticsUserId;
  }

  // Generate new anonymous ID
  const newId = randomUUID();

  // Persist to settings
  setAppSettings({ analyticsUserId: newId } as any);

  return newId;
}

/**
 * Track daily active user event (once per day).
 */
async function trackDailyActive(): Promise<void> {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  // Skip if already tracked today
  if (lastDailyActiveCheck === today) {
    return;
  }

  lastDailyActiveCheck = today;

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
    console.warn("Failed to capture PostHog event:", err);
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
    console.warn("Failed to identify PostHog user:", err);
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
    console.warn("Failed to shutdown PostHog:", err);
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
