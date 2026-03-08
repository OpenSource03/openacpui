import { memo, useState, useCallback, useEffect } from "react";
import { BarChart3 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingRow } from "@/components/settings/shared";
import type { AppSettings } from "@/types/ui";

interface AnalyticsSettingsProps {
  appSettings: AppSettings | null;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

// ── Component ──

export const AnalyticsSettings = memo(function AnalyticsSettings({
  appSettings,
  onUpdateAppSettings,
}: AnalyticsSettingsProps) {
  // Local optimistic state — synced from props once loaded
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    if (appSettings) {
      setAnalyticsEnabled(appSettings.analyticsEnabled ?? true);
      setUserId(appSettings.analyticsUserId ?? null);
    }
  }, [appSettings]);

  const handleToggleAnalytics = useCallback(
    async (checked: boolean) => {
      setAnalyticsEnabled(checked); // optimistic
      await onUpdateAppSettings({ analyticsEnabled: checked });
    },
    [onUpdateAppSettings],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-foreground/[0.06] px-6 py-4">
        <h2 className="text-base font-semibold text-foreground">Analytics</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Help improve Harnss by sharing anonymous usage data
        </p>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          {/* ── Analytics section ── */}
          <div className="py-3">
            <div className="mb-1 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Usage Analytics
              </span>
            </div>

            <SettingRow
              label="Send anonymous analytics"
              description="Share anonymous usage data to help us understand how people use Harnss and improve the app. We collect app version, platform, and basic feature usage. No code, prompts, or personal data is collected."
            >
              <Switch
                checked={analyticsEnabled}
                onCheckedChange={handleToggleAnalytics}
              />
            </SettingRow>

            {/* Show user ID when analytics is enabled */}
            {analyticsEnabled && userId && (
              <div className="mt-4 rounded-md bg-foreground/[0.03] p-3">
                <p className="text-xs font-medium text-foreground">
                  Anonymous User ID
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground break-all">
                  {userId}
                </p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  This randomly generated ID is used to count unique users without identifying you.
                </p>
              </div>
            )}
          </div>

          {/* ── What we collect section ── */}
          <div className="border-t border-foreground/[0.04] py-3">
            <h3 className="mb-2 text-sm font-medium text-foreground">
              What we collect
            </h3>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-foreground/40" />
                <span>App version and platform (macOS, Windows, Linux)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-foreground/40" />
                <span>Daily active users (to measure engagement)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-foreground/40" />
                <span>Basic feature usage (e.g., which engines are used)</span>
              </li>
            </ul>

            <h3 className="mb-2 mt-4 text-sm font-medium text-foreground">
              What we don't collect
            </h3>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-foreground/40" />
                <span>Your code, prompts, or conversations with AI</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-foreground/40" />
                <span>File paths, project names, or repository URLs</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-foreground/40" />
                <span>Any personal or identifying information</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-foreground/40" />
                <span>API keys or credentials</span>
              </li>
            </ul>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
});
