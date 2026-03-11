import { memo, useState, useCallback, useEffect } from "react";
import { Server } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingRow, SettingsSelect } from "@/components/settings/shared";
import type { AppSettings } from "@/types/ui";

interface AdvancedSettingsProps {
  appSettings: AppSettings | null;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
  section: "engines" | "advanced";
  /** Resets the welcome wizard so it shows again. Dev-only. */
  onReplayWelcome: () => void;
}

// ── Component ──

export const AdvancedSettings = memo(function AdvancedSettings({
  appSettings,
  onUpdateAppSettings,
  section,
  onReplayWelcome,
}: AdvancedSettingsProps) {
  const [codexClientName, setCodexClientName] = useState("Harnss");
  const [codexBinarySource, setCodexBinarySource] = useState<"auto" | "managed" | "custom">("auto");
  const [codexCustomBinaryPath, setCodexCustomBinaryPath] = useState("");
  const [claudeBinarySource, setClaudeBinarySource] = useState<"auto" | "managed" | "custom">("auto");
  const [claudeCustomBinaryPath, setClaudeCustomBinaryPath] = useState("");
  const [showDevFillInChatTitleBar, setShowDevFillInChatTitleBar] = useState(false);
  const [showJiraBoard, setShowJiraBoard] = useState(false);

  useEffect(() => {
    if (appSettings) {
      setCodexClientName(appSettings.codexClientName || "Harnss");
      setCodexBinarySource(appSettings.codexBinarySource || "auto");
      setCodexCustomBinaryPath(appSettings.codexCustomBinaryPath || "");
      setClaudeBinarySource(appSettings.claudeBinarySource || "auto");
      setClaudeCustomBinaryPath(appSettings.claudeCustomBinaryPath || "");
      setShowDevFillInChatTitleBar(!!appSettings.showDevFillInChatTitleBar);
      setShowJiraBoard(!!appSettings.showJiraBoard);
    }
  }, [appSettings]);

  const handleClientNameChange = useCallback(
    async (value: string) => {
      // Strip whitespace and limit length
      const trimmed = value.trim();
      if (!trimmed) return;
      setCodexClientName(trimmed); // optimistic
      await onUpdateAppSettings({ codexClientName: trimmed });
    },
    [onUpdateAppSettings],
  );

  const handleBinarySourceChange = useCallback(
    async (source: "auto" | "managed" | "custom") => {
      setCodexBinarySource(source);
      await onUpdateAppSettings({ codexBinarySource: source });
    },
    [onUpdateAppSettings],
  );

  const handleCustomPathSave = useCallback(
    async (value: string) => {
      const next = value.trim();
      setCodexCustomBinaryPath(next);
      await onUpdateAppSettings({ codexCustomBinaryPath: next });
    },
    [onUpdateAppSettings],
  );

  const handleClaudeBinarySourceChange = useCallback(
    async (source: "auto" | "managed" | "custom") => {
      setClaudeBinarySource(source);
      await onUpdateAppSettings({ claudeBinarySource: source });
    },
    [onUpdateAppSettings],
  );

  const handleClaudeCustomPathSave = useCallback(
    async (value: string) => {
      const next = value.trim();
      setClaudeCustomBinaryPath(next);
      await onUpdateAppSettings({ claudeCustomBinaryPath: next });
    },
    [onUpdateAppSettings],
  );

  const handleDevFillToggle = useCallback(
    async (checked: boolean) => {
      setShowDevFillInChatTitleBar(checked);
      await onUpdateAppSettings({ showDevFillInChatTitleBar: checked });
    },
    [onUpdateAppSettings],
  );

  const handleJiraBoardToggle = useCallback(
    async (checked: boolean) => {
      setShowJiraBoard(checked);
      await onUpdateAppSettings({ showJiraBoard: checked });
    },
    [onUpdateAppSettings],
  );

  const canConfigureDevFill = section === "advanced" && import.meta.env.DEV;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-foreground/[0.06] px-6 py-4">
        <h2 className="text-base font-semibold text-foreground">
          {section === "engines" ? "Engines" : "Advanced"}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {section === "engines"
            ? "Configure engine-level runtime behavior and binary selection"
            : "Low-level settings for protocol behavior and server communication"}
        </p>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          {/* ── Claude Code section ── */}
          {section === "engines" && (
            <div className="py-3">
              <div className="mb-1 flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" />
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Claude Code
                </span>
              </div>

              <SettingRow
                label="Claude binary source"
                description="Choose how Harnss resolves the Claude executable."
              >
                <SettingsSelect
                  value={claudeBinarySource}
                  onValueChange={(v) => handleClaudeBinarySourceChange(v as "auto" | "managed" | "custom")}
                  options={[
                    { value: "auto", label: "Auto detect" },
                    { value: "managed", label: "Managed install" },
                    { value: "custom", label: "Custom path" },
                  ]}
                  className="w-44"
                />
              </SettingRow>

              {claudeBinarySource === "custom" && (
                <SettingRow
                  label="Custom Claude path"
                  description="Absolute path to claude executable (claude or claude.exe)."
                >
                  <input
                    type="text"
                    value={claudeCustomBinaryPath}
                    onChange={(e) => setClaudeCustomBinaryPath(e.target.value)}
                    onBlur={(e) => handleClaudeCustomPathSave(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleClaudeCustomPathSave(e.currentTarget.value);
                    }}
                    spellCheck={false}
                    className="h-8 w-80 rounded-md border border-foreground/10 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20"
                    placeholder="Absolute path to claude executable"
                  />
                </SettingRow>
              )}
            </div>
          )}

          {/* ── Codex section ── */}
          <div className="py-3">
            <div className="mb-1 flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Codex
              </span>
            </div>

            {section === "advanced" && (
              <SettingRow
                label="Client name"
                description="How this app identifies itself to Codex servers during the handshake. Changes take effect on new sessions."
              >
                <input
                  type="text"
                  value={codexClientName}
                  onChange={(e) => setCodexClientName(e.target.value)}
                  onBlur={(e) => handleClientNameChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleClientNameChange(e.currentTarget.value);
                  }}
                  spellCheck={false}
                  className="h-8 w-40 rounded-md border border-foreground/10 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20"
                  placeholder="Harnss"
                />
              </SettingRow>
            )}

            {canConfigureDevFill && (
              <SettingRow
                label="Show Dev Fill in chat title bar"
                description="Enable developer seeding actions in the active chat title bar. Hidden by default."
              >
                <Switch
                  checked={showDevFillInChatTitleBar}
                  onCheckedChange={handleDevFillToggle}
                />
              </SettingRow>
            )}

            {section === "advanced" && (
              <SettingRow
                label="Enable Jira board"
                description="Show the Jira board UI in project sidebars and chats. This is a developer preview."
              >
                <Switch
                  checked={showJiraBoard}
                  onCheckedChange={handleJiraBoardToggle}
                />
              </SettingRow>
            )}

            {canConfigureDevFill && (
              <SettingRow
                label="Replay welcome wizard"
                description="Reset the onboarding flag and relaunch the welcome wizard."
              >
                <button
                  onClick={onReplayWelcome}
                  className="rounded-md border border-foreground/10 bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-foreground/20 hover:bg-foreground/[0.03]"
                >
                  Replay
                </button>
              </SettingRow>
            )}

            {section === "engines" && (
              <SettingRow
                label="Codex binary source"
                description="Choose how Harnss resolves the Codex executable."
              >
                <SettingsSelect
                  value={codexBinarySource}
                  onValueChange={(v) => handleBinarySourceChange(v as "auto" | "managed" | "custom")}
                  options={[
                    { value: "auto", label: "Auto detect" },
                    { value: "managed", label: "Managed download" },
                    { value: "custom", label: "Custom path" },
                  ]}
                  className="w-44"
                />
              </SettingRow>
            )}

            {section === "engines" && codexBinarySource === "custom" && (
              <SettingRow
                label="Custom Codex path"
                description="Absolute path to codex executable (codex or codex.exe)."
              >
                <input
                  type="text"
                  value={codexCustomBinaryPath}
                  onChange={(e) => setCodexCustomBinaryPath(e.target.value)}
                  onBlur={(e) => handleCustomPathSave(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCustomPathSave(e.currentTarget.value);
                  }}
                  spellCheck={false}
                  className="h-8 w-80 rounded-md border border-foreground/10 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20"
                  placeholder="Absolute path to codex executable"
                />
              </SettingRow>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
});
