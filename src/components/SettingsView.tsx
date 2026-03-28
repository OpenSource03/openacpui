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
  BarChart3,
  PanelLeft,
  Globe,
  Scan,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentSettings } from "@/components/settings/AgentSettings";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { GeneralSettings } from "@/components/settings/GeneralSettings";
import { NotificationsSettings } from "@/components/settings/NotificationsSettings";
import { McpSettings } from "@/components/settings/McpSettings";
import { AdvancedSettings } from "@/components/settings/AdvancedSettings";
import { PlaceholderSection } from "@/components/settings/PlaceholderSection";
import { AboutSettings } from "@/components/settings/AboutSettings";
import { AnalyticsSettings } from "@/components/settings/AnalyticsSettings";
import { WebSearchSettings } from "@/components/settings/WebSearchSettings";
import { CrawlerSettings } from "@/components/settings/CrawlerSettings";
import { SkillsSettings } from "@/components/settings/SkillsSettings";
import { isMac } from "@/lib/utils";
import type { InstalledAgent, ThemeOption } from "@/types";
import type { AppSettings } from "@/types/ui";
import { useEditorTheme } from "@/hooks/useEditorTheme";

// ── Section definitions ──

type SettingsSection = "general" | "appearance" | "notifications" | "analytics" | "agents" | "mcp" | "engines" | "web-search" | "crawler" | "skills" | "custom-agents" | "advanced" | "about";

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
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "agents", label: "ACP Agents", icon: Bot },
  { id: "mcp", label: "MCP Servers", icon: Plug },
  { id: "engines", label: "Engines", icon: Cpu },
  { id: "web-search", label: "Web Search", icon: Globe },
  { id: "crawler", label: "Crawler", icon: Scan },
  { id: "skills", label: "Skills", icon: Sparkles },
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
  avoidGroupingEdits: boolean;
  onAvoidGroupingEditsChange: (enabled: boolean) => void;
  autoExpandTools: boolean;
  onAutoExpandToolsChange: (enabled: boolean) => void;
  transparentToolPicker: boolean;
  onTransparentToolPickerChange: (enabled: boolean) => void;
  coloredSidebarIcons: boolean;
  onColoredSidebarIconsChange: (enabled: boolean) => void;
  transparency: boolean;
  onTransparencyChange: (enabled: boolean) => void;
  glassSupported: boolean;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  /** Resets the welcome wizard so it shows again. Dev-only. */
  onReplayWelcome: () => void;
  projectId?: string | null;
  projectPath?: string | null;
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
  avoidGroupingEdits,
  onAvoidGroupingEditsChange,
  autoExpandTools,
  onAutoExpandToolsChange,
  transparentToolPicker,
  onTransparentToolPickerChange,
  coloredSidebarIcons,
  onColoredSidebarIconsChange,
  transparency,
  onTransparencyChange,
  glassSupported,
  sidebarOpen = false,
  onToggleSidebar,
  onReplayWelcome,
  projectId,
  projectPath,
}: SettingsViewProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const macIslandTitlebarOffsetClass = "";
  const { currentThemeId, setTheme: setEditorTheme } = useEditorTheme();

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
            editorThemeId={currentThemeId}
            onEditorThemeChange={setEditorTheme}
            islandLayout={islandLayout}
            onIslandLayoutChange={onIslandLayoutChange}
            autoGroupTools={autoGroupTools}
            onAutoGroupToolsChange={onAutoGroupToolsChange}
            avoidGroupingEdits={avoidGroupingEdits}
            onAvoidGroupingEditsChange={onAvoidGroupingEditsChange}
            autoExpandTools={autoExpandTools}
            onAutoExpandToolsChange={onAutoExpandToolsChange}
            transparentToolPicker={transparentToolPicker}
            onTransparentToolPickerChange={onTransparentToolPickerChange}
            coloredSidebarIcons={coloredSidebarIcons}
            onColoredSidebarIconsChange={onColoredSidebarIconsChange}
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
      case "analytics":
        return (
          <AnalyticsSettings
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
        return <McpSettings projectId={projectId ?? null} />;
      case "engines":
        return (
          <AdvancedSettings
            appSettings={appSettings}
            onUpdateAppSettings={updateAppSettings}
            section="engines"
            onReplayWelcome={onReplayWelcome}
          />
        );
      case "web-search":
        return (
          <WebSearchSettings
            appSettings={appSettings}
            onUpdateAppSettings={updateAppSettings}
          />
        );
      case "crawler":
        return (
          <CrawlerSettings
            appSettings={appSettings}
            onUpdateAppSettings={updateAppSettings}
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
        return <SkillsSettings projectPath={projectPath} />;
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
  }, [activeSection, appSettings, updateAppSettings, agents, onSaveAgent, onDeleteAgent, theme, onThemeChange, islandLayout, onIslandLayoutChange, autoGroupTools, onAutoGroupToolsChange, avoidGroupingEdits, onAvoidGroupingEditsChange, autoExpandTools, onAutoExpandToolsChange, transparentToolPicker, onTransparentToolPickerChange, coloredSidebarIcons, onColoredSidebarIconsChange, transparency, onTransparencyChange, glassSupported, onReplayWelcome]);

  return (
    <div className={`island flex flex-1 flex-col overflow-hidden bg-background ${islandLayout ? "rounded-[var(--island-radius)]" : "rounded-none"}`}>
      <div
        className={`drag-region flex shrink-0 items-center border-b border-foreground/[0.06] ${
          islandLayout ? "h-[2.375rem] px-4" : "h-[3.25rem] px-4"
        } ${
          !sidebarOpen && isMac ? (islandLayout ? "ps-[78px]" : "ps-[84px]") : ""
        }`}
      >
        {onToggleSidebar && !sidebarOpen && (
          <Button
            variant="ghost"
            size="icon"
            className={`no-drag me-2 h-7 w-7 text-muted-foreground/60 hover:text-foreground ${macIslandTitlebarOffsetClass}`}
            onClick={onToggleSidebar}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        )}
        <span className={`leading-none text-sm font-semibold text-foreground ${macIslandTitlebarOffsetClass}`}>Settings</span>
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
