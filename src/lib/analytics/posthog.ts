/**
 * PostHog renderer-side client initialization.
 *
 * Provides posthog-js instance for React error tracking and exception autocapture.
 * Respects the analytics opt-in/out setting from the main process.
 * Uses the same anonymous user ID as the main process client (posthog-node).
 *
 * Exception autocapture automatically hooks into window.onerror and
 * window.onunhandledrejection to capture unhandled errors as $exception events.
 */

import posthog from "posthog-js";

// Same public API key used by the main process (posthog-node).
// PostHog project API keys are client-side safe — designed to be embedded in source.
const POSTHOG_KEY = "phc_lOKFRov0SWy2R71BNJ2t978tmNYc3ND7WwueOteV5vw";
const POSTHOG_HOST = "https://us.i.posthog.com";

/**
 * Initialize posthog-js in the renderer process.
 *
 * Starts with capturing disabled (opt_out_capturing_by_default).
 * Call {@link syncAnalyticsSettings} after loading app settings to enable
 * capturing based on the user's preference.
 */
export function initPostHog(): void {
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    defaults: "2026-01-30",

    // ── Privacy: start opted out until we confirm the user has opted in ──
    opt_out_capturing_by_default: true,

    // ── Electron-specific: disable web-oriented autocapture ──
    // No meaningful pageviews/pageleaves in a single-window Electron app
    capture_pageview: false,
    capture_pageleave: false,
    // Disable generic click/input autocapture — we only want exception tracking
    autocapture: false,

    // ── Persistence ──
    persistence: "localStorage",
  });
}

/**
 * Sync posthog-js capturing state with the main process analytics settings.
 *
 * Reads AppSettings via IPC and enables/disables capturing + sets the
 * anonymous user ID to match the main process client.
 *
 * Call this:
 * - Once after app mount (settings become available)
 * - Whenever the user toggles analytics on/off in settings
 */
export async function syncAnalyticsSettings(): Promise<void> {
  try {
    const settings = await window.claude.settings.get();

    if (settings.analyticsEnabled) {
      posthog.opt_in_capturing();

      // Use the same anonymous user ID as the main process PostHog client
      // so events from both processes correlate to the same distinct_id.
      if (settings.analyticsUserId) {
        posthog.identify(settings.analyticsUserId);
      }
    } else {
      posthog.opt_out_capturing();
    }
  } catch {
    // Settings not available yet — stay opted out (safe default)
  }
}

export { posthog };
