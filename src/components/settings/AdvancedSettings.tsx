import { memo, useState, useCallback, useEffect } from "react";
import { Server } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingRow, SettingsHeader, SettingsSection } from "@/components/settings/shared";
import type { AppSettings } from "@/types";

interface AdvancedSettingsProps {
  appSettings: AppSettings | null;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
  /** Resets the welcome wizard so it shows again. Dev-only. */
  onReplayWelcome: () => void;
}

// ── Component ──

export const AdvancedSettings = memo(function AdvancedSettings({
  appSettings,
  onUpdateAppSettings,
  onReplayWelcome,
}: AdvancedSettingsProps) {
  const [codexClientName, setCodexClientName] = useState("Harnss");
  const [showDevFillInChatTitleBar, setShowDevFillInChatTitleBar] = useState(false);
  const [showJiraBoard, setShowJiraBoard] = useState(false);

  useEffect(() => {
    if (appSettings) {
      setCodexClientName(appSettings.codexClientName || "Harnss");
      setShowDevFillInChatTitleBar(!!appSettings.showDevFillInChatTitleBar);
      setShowJiraBoard(!!appSettings.showJiraBoard);
    }
  }, [appSettings]);

  const handleClientNameChange = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      setCodexClientName(trimmed);
      await onUpdateAppSettings({ codexClientName: trimmed });
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

  const isDev = import.meta.env.DEV;

  return (
    <div className="flex h-full flex-col">
      <SettingsHeader
        title="Advanced"
        description="Low-level settings for protocol behavior and server communication"
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          <SettingsSection icon={Server} label="Codex" first>
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

            {isDev && (
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

            <SettingRow
              label="Enable Jira board"
              description="Show the Jira board UI in project sidebars and chats. This is a developer preview."
            >
              <Switch
                checked={showJiraBoard}
                onCheckedChange={handleJiraBoardToggle}
              />
            </SettingRow>

            {isDev && (
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
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  );
});
