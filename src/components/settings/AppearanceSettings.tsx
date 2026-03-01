import { memo } from "react";
import { SunMoon, Layout, Blend } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingRow, selectClass } from "@/components/settings/shared";
import type { ThemeOption } from "@/types";

// ── Props ──

interface AppearanceSettingsProps {
  theme: ThemeOption;
  onThemeChange: (t: ThemeOption) => void;
  islandLayout: boolean;
  onIslandLayoutChange: (enabled: boolean) => void;
  transparency: boolean;
  onTransparencyChange: (enabled: boolean) => void;
  /** Whether the platform supports transparency (glass/mica) */
  glassSupported: boolean;
}

// ── Component ──

export const AppearanceSettings = memo(function AppearanceSettings({
  theme,
  onThemeChange,
  islandLayout,
  onIslandLayoutChange,
  transparency,
  onTransparencyChange,
  glassSupported,
}: AppearanceSettingsProps) {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-foreground/[0.06] px-6 py-4">
        <h2 className="text-base font-semibold text-foreground">Appearance</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Customize the look and feel of the interface
        </p>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          {/* ── Theme section ── */}
          <div className="py-3">
            <div className="mb-1 flex items-center gap-2">
              <SunMoon className="h-4 w-4 text-muted-foreground" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Theme
              </span>
            </div>

            <SettingRow
              label="Color theme"
              description="Choose between light and dark appearance, or follow your system setting."
            >
              <select
                value={theme}
                onChange={(e) => onThemeChange(e.target.value as ThemeOption)}
                className={selectClass}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">System</option>
              </select>
            </SettingRow>
          </div>

          {/* ── Layout section ── */}
          <div className="border-t border-foreground/[0.04] py-3">
            <div className="mb-1 flex items-center gap-2">
              <Layout className="h-4 w-4 text-muted-foreground" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Layout
              </span>
            </div>

            <SettingRow
              label="Island layout"
              description="Show sections as rounded, separated islands with glass-effect borders. Disable for a flat, edge-to-edge layout."
            >
              <Switch
                checked={islandLayout}
                onCheckedChange={onIslandLayoutChange}
              />
            </SettingRow>
          </div>

          {/* ── Transparency section ── */}
          <div className="border-t border-foreground/[0.04] py-3">
            <div className="mb-1 flex items-center gap-2">
              <Blend className="h-4 w-4 text-muted-foreground" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Transparency
              </span>
            </div>

            <SettingRow
              label="Window transparency"
              description={
                glassSupported
                  ? "Allow the desktop to show through the window background. Uses Liquid Glass on macOS or Mica on Windows."
                  : "Window transparency is not available on this platform."
              }
            >
              <Switch
                checked={transparency}
                onCheckedChange={onTransparencyChange}
                disabled={!glassSupported}
              />
            </SettingRow>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
});
