import { memo, useState, useCallback, useEffect } from "react";
import { Download, MessageSquare, Code, Mic } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingRow, selectClass } from "@/components/settings/shared";
import type { AppSettings, PreferredEditor, VoiceDictationMode } from "@/types/ui";

interface GeneralSettingsProps {
  appSettings: AppSettings | null;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

// ── Component ──

export const GeneralSettings = memo(function GeneralSettings({
  appSettings,
  onUpdateAppSettings,
}: GeneralSettingsProps) {
  // Local optimistic state — synced from props once loaded
  const [allowPrerelease, setAllowPrerelease] = useState(true);
  const [chatLimit, setChatLimit] = useState(10);
  const [preferredEditor, setPreferredEditor] = useState<PreferredEditor>("auto");
  const [voiceDictation, setVoiceDictation] = useState<VoiceDictationMode>("native");

  useEffect(() => {
    if (appSettings) {
      setAllowPrerelease(appSettings.allowPrereleaseUpdates);
      setChatLimit(appSettings.defaultChatLimit || 10);
      setPreferredEditor(appSettings.preferredEditor || "auto");
      setVoiceDictation(appSettings.voiceDictation || "native");
    }
  }, [appSettings]);

  const handleTogglePrerelease = useCallback(
    async (checked: boolean) => {
      setAllowPrerelease(checked); // optimistic
      await onUpdateAppSettings({ allowPrereleaseUpdates: checked });
    },
    [onUpdateAppSettings],
  );

  const handleChatLimitChange = useCallback(
    async (value: number) => {
      const clamped = Math.max(5, Math.min(100, value));
      setChatLimit(clamped);
      await onUpdateAppSettings({ defaultChatLimit: clamped });
    },
    [onUpdateAppSettings],
  );

  const handleEditorChange = useCallback(
    async (value: PreferredEditor) => {
      setPreferredEditor(value); // optimistic
      await onUpdateAppSettings({ preferredEditor: value });
    },
    [onUpdateAppSettings],
  );

  const handleVoiceDictationChange = useCallback(
    async (value: VoiceDictationMode) => {
      setVoiceDictation(value); // optimistic
      await onUpdateAppSettings({ voiceDictation: value });
    },
    [onUpdateAppSettings],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-foreground/[0.06] px-6 py-4">
        <h2 className="text-base font-semibold text-foreground">General</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Application-wide preferences
        </p>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          {/* ── Updates section ── */}
          <div className="py-3">
            <div className="mb-1 flex items-center gap-2">
              <Download className="h-4 w-4 text-muted-foreground" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Updates
              </span>
            </div>

            <SettingRow
              label="Include pre-release updates"
              description="Receive beta versions with the latest features. Disable to only get stable releases."
            >
              <Switch
                checked={allowPrerelease}
                onCheckedChange={handleTogglePrerelease}
              />
            </SettingRow>
          </div>

          {/* ── Sidebar section ── */}
          <div className="border-t border-foreground/[0.04] py-3">
            <div className="mb-1 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Sidebar
              </span>
            </div>

            <SettingRow
              label="Recent chats per project"
              description="Number of chats shown by default in each project. Click 'Show more' in the sidebar to load additional chats."
            >
              <div className="flex items-center gap-2">
                <select
                  value={chatLimit}
                  onChange={(e) => handleChatLimitChange(Number(e.target.value))}
                  className={selectClass}
                >
                  {[5, 10, 15, 20, 25, 30, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </SettingRow>
          </div>

          {/* ── Editor section ── */}
          <div className="border-t border-foreground/[0.04] py-3">
            <div className="mb-1 flex items-center gap-2">
              <Code className="h-4 w-4 text-muted-foreground" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Editor
              </span>
            </div>

            <SettingRow
              label="Default editor"
              description="Choose which editor opens when you click 'Open in Editor'. Auto tries Cursor, VS Code, then Zed."
            >
              <select
                value={preferredEditor}
                onChange={(e) => handleEditorChange(e.target.value as PreferredEditor)}
                className={selectClass}
              >
                <option value="auto">Auto</option>
                <option value="cursor">Cursor</option>
                <option value="code">VS Code</option>
                <option value="zed">Zed</option>
              </select>
            </SettingRow>
          </div>

          {/* ── Voice Dictation section ── */}
          <div className="border-t border-foreground/[0.04] py-3">
            <div className="mb-1 flex items-center gap-2">
              <Mic className="h-4 w-4 text-muted-foreground" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Voice Dictation
              </span>
            </div>

            <SettingRow
              label="Dictation mode"
              description="Native uses your OS dictation (macOS only). Whisper runs a local AI model for speech-to-text on all platforms (~40 MB download on first use)."
            >
              <select
                value={voiceDictation}
                onChange={(e) => handleVoiceDictationChange(e.target.value as VoiceDictationMode)}
                className={selectClass}
              >
                <option value="native">Native (OS)</option>
                <option value="whisper">Whisper (Local AI)</option>
              </select>
            </SettingRow>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
});
