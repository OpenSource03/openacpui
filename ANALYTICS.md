# PostHog Analytics Setup

Harnss includes optional, privacy-friendly analytics powered by PostHog.

## Quick Start

Set your PostHog API key as an environment variable:

```bash
export POSTHOG_API_KEY="phc_your_api_key_here"
```

Then run the app. Analytics will be enabled by default but can be disabled in Settings → Analytics.

## What's Tracked

- **App version usage** - Which versions are being used
- **Daily active users** - Unique users per day (anonymous)
- **Platform distribution** - macOS, Windows, Linux usage
- **App start events** - Launch frequency

## Privacy

- ✅ **Anonymous** - Uses a randomly generated UUID
- ✅ **No personal data** - No code, prompts, or file paths collected
- ✅ **Opt-out available** - Can be disabled in Settings
- ✅ **No tracking across apps** - Each installation has a unique ID

## Configuration

### 1. Get a PostHog API Key

1. Sign up at https://posthog.com (free tier available)
2. Create a new project
3. Copy your API key from Project Settings → API Keys

### 2. Set the API Key

**Option A: Environment Variable (Recommended)**
```bash
export POSTHOG_API_KEY="phc_your_key"
pnpm dev
```

**Option B: Hardcode (For production builds)**

Edit `electron/src/lib/posthog.ts`:
```typescript
const apiKey = process.env.POSTHOG_API_KEY || "phc_your_production_key";
```

### 3. Choose Data Region (Optional)

For GDPR compliance, you can use EU servers:

Edit `electron/src/lib/posthog.ts`:
```typescript
client = new PostHog(apiKey, {
  host: "https://eu.i.posthog.com",  // EU region
  // ...
});
```

## User Controls

Users can manage analytics in **Settings → Analytics**:
- Toggle analytics on/off
- View their anonymous user ID
- See what data is/isn't collected

## Implementation Files

- **Main process**: `electron/src/lib/posthog.ts`
- **Settings**: `electron/src/lib/app-settings.ts` (analyticsEnabled, analyticsUserId)
- **UI**: `src/components/settings/AnalyticsSettings.tsx`
- **Integration**: `electron/src/main.ts` (initialization and shutdown)

## Adding Custom Events

To track additional events:

```typescript
import { captureEvent } from "./lib/posthog";

await captureEvent("feature_used", {
  feature: "terminal",
  engine: "claude",
});
```

## Disabling Analytics Completely

If you're forking and don't want any analytics:

1. Remove PostHog initialization from `electron/src/main.ts`
2. Remove the Analytics section from `src/components/SettingsView.tsx`
3. Remove `posthog-node` from `package.json`
