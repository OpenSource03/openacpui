import { memo, useState, useCallback, useEffect } from "react";
import {
  SlidersHorizontal,
  Bell,
  Bot,
  Plug,
  Cpu,
  Info,
  Wrench,
  Palette,
  Sparkles,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AgentSettings } from "@/components/settings/AgentSettings";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { GeneralSettings } from "@/components/settings/GeneralSettings";
import { NotificationsSettings } from "@/components/settings/NotificationsSettings";
import { McpSettings } from "@/components/settings/McpSettings";
import { AdvancedSettings } from "@/components/settings/AdvancedSettings";
import { PlaceholderSection } from "@/components/settings/PlaceholderSection";
import { AboutSettings } from "@/components/settings/AboutSettings";
import { isMac } from "@/lib/utils";
import type { InstalledAgent, ThemeOption } from "@/types";
import type { AppSettings } from "@/types/ui";

// ── Section definitions ──

type SettingsSection = "general" | "appearance" | "notifications" | "agents" | "mcp" | "engines" | "skills" | "custom-agents" | "advanced" | "about";

interface NavItem {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  /** Renders a subtle "soon" indicator next to the label */
  comingSoon?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "agents", label: "ACP Agents", icon: Bot },
  { id: "mcp", label: "MCP Servers", icon: Plug },
  { id: "engines", label: "Engines", icon: Cpu },
  { id: "skills", label: "Skills", icon: Sparkles, comingSoon: true },
  { id: "custom-agents", label: "Agents", icon: Users, comingSoon: true },
  { id: "advanced", label: "Advanced", icon: Wrench },
  { id: "about", label: "About", icon: Info },
];

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
  autoGroupTools: boolean;
  onAutoGroupToolsChange: (enabled: boolean) => void;
  transparency: boolean;
  onTransparencyChange: (enabled: boolean) => void;
  glassSupported: boolean;
  sidebarOpen?: boolean;
  /** Resets the welcome wizard so it shows again. Dev-only. */
  onReplayWelcome: () => void;
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
  autoGroupTools,
  onAutoGroupToolsChange,
  transparency,
  onTransparencyChange,
  glassSupported,
  sidebarOpen = false,
  onReplayWelcome,
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
            autoGroupTools={autoGroupTools}
            onAutoGroupToolsChange={onAutoGroupToolsChange}
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
      case "engines":
        return (
          <AdvancedSettings
            appSettings={appSettings}
            onUpdateAppSettings={updateAppSettings}
            section="engines"
            onReplayWelcome={onReplayWelcome}
          />
        );
      case "advanced":
        return (
          <AdvancedSettings
            appSettings={appSettings}
            onUpdateAppSettings={updateAppSettings}
            section="advanced"
            onReplayWelcome={onReplayWelcome}
          />
        );
      case "skills":
        return (
          <PlaceholderSection
            title="Skills"
            description="Create, install, and manage agent skills that extend what your AI coding agents can do."
            icon={Sparkles}
            comingSoon
          />
        );
      case "custom-agents":
        return (
          <PlaceholderSection
            title="Agents"
            description="Build and configure custom agents with specialized tools, prompts, and workflows."
            icon={Users}
            comingSoon
          />
        );
      case "about":
        return <AboutSettings />;
      default:
        return null;
    }
  }, [activeSection, appSettings, updateAppSettings, agents, onSaveAgent, onDeleteAgent, theme, onThemeChange, islandLayout, onIslandLayoutChange, autoGroupTools, onAutoGroupToolsChange, transparency, onTransparencyChange, glassSupported, onReplayWelcome]);

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
        <div className="flex w-44 shrink-0 flex-col border-e border-foreground/[0.06]">
          {/* Nav items */}
          <nav className="flex flex-1 flex-col gap-0.5 px-1.5 py-2">
            {NAV_ITEMS.map((item) => {
              const isActive = activeSection === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={`flex w-full items-center justify-start gap-2 rounded-md px-2 py-1.5 text-[13px] text-start transition-colors ${
                    isActive
                      ? "bg-foreground/[0.06] font-medium text-foreground"
                      : "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {item.comingSoon && (
                    <span className="rounded bg-foreground/[0.06] px-1.5 py-px text-[10px] font-medium text-muted-foreground/70">
                      Soon
                    </span>
                  )}
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
