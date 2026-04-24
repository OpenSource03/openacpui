import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PostHogProvider } from "@posthog/react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { migrateLocalStorage } from "./lib/local-storage-migration";
import { migrateSettingsIfNeeded } from "./stores/settings-store";
import {
  deleteBrowserSession,
  makeSessionBrowserPersistKey,
} from "./components/browser/browser-utils";
import { initPostHog, posthog } from "./lib/analytics/posthog";
import { App } from "./App";
import "./index.css";

// Migrate localStorage keys from old "openacpui-*" prefix before React mounts
migrateLocalStorage();

// Hydrate Zustand settings store from legacy per-key localStorage entries.
// Must run before createRoot() so components read correct initial values.
migrateSettingsIfNeeded();

// Drafts are ephemeral. Any persisted DRAFT_ID browser session belongs to a
// draft that never materialized in a previous app run — discard it so a fresh
// "New Chat" starts with a clean browser tab list.
deleteBrowserSession(makeSessionBrowserPersistKey("__draft__"));

// Initialize posthog-js (starts opted-out until settings confirm opt-in)
initPostHog();

// Analytics opt-in sync is deferred to after React mount (in App.tsx useEffect)
// to avoid firing IPC calls before first paint.

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PostHogProvider client={posthog}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </PostHogProvider>
  </StrictMode>,
);
