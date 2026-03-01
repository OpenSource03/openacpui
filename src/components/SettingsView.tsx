import { memo, useState, useCallback, useEffect } from "react";
import {
  SlidersHorizontal,
  Bell,
  Bot,
  Plug,
  Cpu,
  Keyboard,
  Info,
  Wrench,
  Palette,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AgentSettings } from "@/components/settings/AgentSettings";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { GeneralSettings } from "@/components/settings/GeneralSettings";
import { NotificationsSettings } from "@/components/settings/NotificationsSettings";
import { McpSettings } from "@/components/settings/McpSettings";
import { AdvancedSettings } from "@/components/settings/AdvancedSettings";
import { PlaceholderSection } from "@/components/settings/PlaceholderSection";
import { isMac } from "@/lib/utils";
import type { InstalledAgent, ThemeOption } from "@/types";
import type { NotificationSettings } from "@/types/ui";

// ── Section definitions ──

type SettingsSection = "general" | "appearance" | "notifications" | "agents" | "mcp" | "models" | "shortcuts" | "advanced" | "about";

interface NavItem {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "agents", label: "ACP Agents", icon: Bot },
  { id: "mcp", label: "MCP Servers", icon: Plug },
  { id: "models", label: "Models", icon: Cpu },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "advanced", label: "Advanced", icon: Wrench },
  { id: "about", label: "About", icon: Info },
];

// ── App settings types (mirrors electron/src/lib/app-settings.ts) ──

interface AppSettings {
  allowPrereleaseUpdates: boolean;
  defaultChatLimit: number;
  preferredEditor: "auto" | "cursor" | "code" | "zed";
  voiceDictation: "native" | "whisper";
  notifications: NotificationSettings;
  codexClientName: string;
}

// ── Props ──

interface SettingsViewProps {
  onClose: () => void;
  agents: InstalledAgent[];
  onSaveAgent: (agent: InstalledAgent) => Promise<{ ok?: boolean; error?: string }>;
  onDeleteAgent: (id: string) => Promise<{ ok?: boolean; error?: string }>;
  theme: ThemeOption;
  onThemeChange: (t: ThemeOption) => void;
  islandLayout: boolean;
  onIslandLayoutChange: (enabled: boolean) => void;
  transparency: boolean;
  onTransparencyChange: (enabled: boolean) => void;
  glassSupported: boolean;
  sidebarOpen?: boolean;
}

// ── Component ──

export const SettingsView = memo(function SettingsView({
  onClose,
  agents,
  onSaveAgent,
  onDeleteAgent,
  theme,
  onThemeChange,
  islandLayout,
  onIslandLayoutChange,
  transparency,
  onTransparencyChange,
  glassSupported,
  sidebarOpen = false,
}: SettingsViewProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");

  // ── Main-process app settings (loaded once, updated optimistically) ──
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    window.claude.settings.get().then((s: AppSettings | null) => {
      if (s) setAppSettings(s);
    });
  }, []);

  const updateAppSettings = useCallback(async (patch: Partial<AppSettings>) => {
    // Optimistic local update
    setAppSettings((prev) => (prev ? { ...prev, ...patch } : null));
    await window.claude.settings.set(patch);
  }, []);

  // Escape key closes settings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const renderSection = useCallback(() => {
    switch (activeSection) {
      case "general":
        return (
          <GeneralSettings
            appSettings={appSettings}
            onUpdateAppSettings={updateAppSettings}
          />
        );
      case "appearance":
        return (
          <AppearanceSettings
            theme={theme}
            onThemeChange={onThemeChange}
            islandLayout={islandLayout}
            onIslandLayoutChange={onIslandLayoutChange}
            transparency={transparency}
            onTransparencyChange={onTransparencyChange}
            glassSupported={glassSupported}
          />
        );
      case "notifications":
        return (
          <NotificationsSettings
            appSettings={appSettings}
            onUpdateAppSettings={updateAppSettings}
          />
        );
      case "agents":
        return (
          <AgentSettings
            agents={agents}
            onSave={onSaveAgent}
            onDelete={onDeleteAgent}
          />
        );
      case "mcp":
        return <McpSettings />;
      case "models":
        return (
          <PlaceholderSection
            title="Model Configuration"
            description="Default model selection and API key management will appear here."
            icon={Cpu}
          />
        );
      case "shortcuts":
        return (
          <PlaceholderSection
            title="Keyboard Shortcuts"
            description="Customize keyboard shortcuts and key bindings here."
            icon={Keyboard}
          />
        );
      case "advanced":
        return (
          <AdvancedSettings
            appSettings={appSettings}
            onUpdateAppSettings={updateAppSettings}
          />
        );
      case "about":
        return (
          <PlaceholderSection
            title="About Harnss"
            description="Version information and project details will appear here."
            icon={Info}
          />
        );
      default:
        return null;
    }
  }, [activeSection, appSettings, updateAppSettings, agents, onSaveAgent, onDeleteAgent, theme, onThemeChange, islandLayout, onIslandLayoutChange, transparency, onTransparencyChange, glassSupported]);

  return (
    <div className="island flex flex-1 flex-col overflow-hidden rounded-lg bg-background">
      <div
        className={`drag-region flex h-10 shrink-0 items-center border-b border-foreground/[0.06] px-4 ${
          !sidebarOpen && isMac ? "ps-[78px]" : ""
        }`}
      >
        <span className="text-sm font-semibold text-foreground">Settings</span>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Settings nav sidebar */}
        <div className="flex w-[200px] shrink-0 flex-col border-e border-foreground/[0.06]">
          {/* Nav items */}
          <nav className="flex flex-1 flex-col gap-0.5 px-2 py-2">
            {NAV_ITEMS.map((item) => {
              const isActive = activeSection === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                    isActive
                      ? "bg-foreground/[0.06] font-medium text-foreground"
                      : "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Content area — centered container with max width */}
        <div className="flex min-w-0 flex-1 justify-center overflow-hidden">
          <div className="flex h-full w-full max-w-3xl flex-col">
            {renderSection()}
          </div>
        </div>
      </div>
    </div>
  );
});
