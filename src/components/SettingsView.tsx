import { memo, useState, useCallback, useEffect } from "react";
import {
  SlidersHorizontal,
  Bot,
  Plug,
  Cpu,
  Keyboard,
  Info,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AgentSettings } from "@/components/settings/AgentSettings";
import { GeneralSettings } from "@/components/settings/GeneralSettings";
import { McpSettings } from "@/components/settings/McpSettings";
import { PlaceholderSection } from "@/components/settings/PlaceholderSection";
import type { AgentDefinition } from "@/types";

// ── Section definitions ──

type SettingsSection = "general" | "agents" | "mcp" | "models" | "shortcuts" | "about";

interface NavItem {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "agents", label: "ACP Agents", icon: Bot },
  { id: "mcp", label: "MCP Servers", icon: Plug },
  { id: "models", label: "Models", icon: Cpu },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "about", label: "About", icon: Info },
];

// ── App settings types (mirrors electron/src/lib/app-settings.ts) ──

interface AppSettings {
  allowPrereleaseUpdates: boolean;
  defaultChatLimit: number;
  preferredEditor: "auto" | "cursor" | "code" | "zed";
}

// ── Props ──

interface SettingsViewProps {
  onClose: () => void;
  agents: AgentDefinition[];
  onSaveAgent: (agent: AgentDefinition) => Promise<{ ok?: boolean; error?: string }>;
  onDeleteAgent: (id: string) => Promise<{ ok?: boolean; error?: string }>;
}

// ── Component ──

export const SettingsView = memo(function SettingsView({
  onClose,
  agents,
  onSaveAgent,
  onDeleteAgent,
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
      case "about":
        return (
          <PlaceholderSection
            title="About OpenACP UI"
            description="Version information and project details will appear here."
            icon={Info}
          />
        );
      default:
        return null;
    }
  }, [activeSection, appSettings, updateAppSettings, agents, onSaveAgent, onDeleteAgent]);

  return (
    <div className="island flex flex-1 overflow-hidden rounded-lg bg-background">
      {/* Settings nav sidebar */}
      <div className="flex w-[200px] shrink-0 flex-col border-e border-foreground/[0.06]">
        {/* Header */}
        <div className="flex items-center px-4 py-3">
          <span className="text-sm font-semibold text-foreground">Settings</span>
        </div>

        {/* Nav items */}
        <nav className="flex flex-1 flex-col gap-0.5 px-2 py-1">
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
  );
});
