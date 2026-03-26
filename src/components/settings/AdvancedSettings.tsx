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
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("http://localhost:11434");
  const [ollamaDefaultModel, setOllamaDefaultModel] = useState("llama3");
  const [ollamaTestStatus, setOllamaTestStatus] = useState<"idle" | "testing" | "connected" | "failed">("idle");
  const [ollamaTestError, setOllamaTestError] = useState<string | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaModelsLoading, setOllamaModelsLoading] = useState(false);

  useEffect(() => {
    if (appSettings) {
      setCodexClientName(appSettings.codexClientName || "Harnss");
      setCodexBinarySource(appSettings.codexBinarySource || "auto");
      setCodexCustomBinaryPath(appSettings.codexCustomBinaryPath || "");
      setClaudeBinarySource(appSettings.claudeBinarySource || "auto");
      setClaudeCustomBinaryPath(appSettings.claudeCustomBinaryPath || "");
      setShowDevFillInChatTitleBar(!!appSettings.showDevFillInChatTitleBar);
      setShowJiraBoard(!!appSettings.showJiraBoard);
      setOllamaBaseUrl(appSettings.ollamaBaseUrl || "http://localhost:11434");
      setOllamaDefaultModel(appSettings.ollamaDefaultModel || "llama3");
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

  const handleOllamaBaseUrlSave = useCallback(
    async (value: string) => {
      const next = value.trim() || "http://localhost:11434";
      setOllamaBaseUrl(next);
      await onUpdateAppSettings({ ollamaBaseUrl: next });
    },
    [onUpdateAppSettings],
  );

  const handleOllamaDefaultModelSave = useCallback(
    async (value: string) => {
      const next = value.trim();
      setOllamaDefaultModel(next);
      await onUpdateAppSettings({ ollamaDefaultModel: next });
    },
    [onUpdateAppSettings],
  );

  const handleTestOllama = useCallback(async () => {
    setOllamaTestStatus("testing");
    setOllamaTestError(null);
    try {
      const result = await window.claude.ollama.status();
      if (result.available) {
        setOllamaTestStatus("connected");
      } else {
        setOllamaTestStatus("failed");
        setOllamaTestError(result.error ?? "Connection failed");
      }
    } catch (err) {
      setOllamaTestStatus("failed");
      setOllamaTestError((err as Error).message || "Connection failed");
    }
    setTimeout(() => { setOllamaTestStatus("idle"); setOllamaTestError(null); }, 6000);
  }, []);

  const handleListOllamaModels = useCallback(async () => {
    setOllamaModelsLoading(true);
    try {
      const result = await window.claude.ollama.listModels();
      if (result.ok) {
        setOllamaModels(result.models);
      } else {
        setOllamaModels([]);
      }
    } catch {
      setOllamaModels([]);
    } finally {
      setOllamaModelsLoading(false);
    }
  }, []);

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

          {/* ── Ollama section ── */}
          {section === "engines" && (
            <div className="py-3">
              <div className="mb-1 flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" />
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Ollama
                </span>
              </div>

              <SettingRow
                label="Server URL"
                description="Base URL of your local Ollama server."
              >
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={ollamaBaseUrl}
                      onChange={(e) => setOllamaBaseUrl(e.target.value)}
                      onBlur={(e) => handleOllamaBaseUrlSave(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleOllamaBaseUrlSave(e.currentTarget.value);
                      }}
                      spellCheck={false}
                      className="h-8 w-64 rounded-md border border-foreground/10 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20"
                      placeholder="http://localhost:11434"
                    />
                    <button
                      onClick={handleTestOllama}
                      disabled={ollamaTestStatus === "testing"}
                      className={`h-8 shrink-0 rounded-md border px-3 text-xs font-medium transition-colors ${
                        ollamaTestStatus === "connected"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                          : ollamaTestStatus === "failed"
                            ? "border-red-500/30 bg-red-500/10 text-red-400"
                            : "border-foreground/10 bg-background text-foreground hover:border-foreground/20 hover:bg-foreground/[0.03]"
                      }`}
                    >
                      {ollamaTestStatus === "testing" ? "Testing..." :
                       ollamaTestStatus === "connected" ? "Connected" :
                       ollamaTestStatus === "failed" ? "Failed" :
                       "Test"}
                    </button>
                  </div>
                  {ollamaTestError && (
                    <p className="text-[11px] text-red-400">{ollamaTestError}</p>
                  )}
                </div>
              </SettingRow>

              <SettingRow
                label="Default model"
                description="Model to use for new Ollama sessions (e.g. llama3, mistral, codellama)."
              >
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={ollamaDefaultModel}
                      onChange={(e) => setOllamaDefaultModel(e.target.value)}
                      onBlur={(e) => handleOllamaDefaultModelSave(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleOllamaDefaultModelSave(e.currentTarget.value);
                      }}
                      spellCheck={false}
                      className="h-8 w-60 rounded-md border border-foreground/10 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20"
                      placeholder="e.g. llama3, mistral, codellama"
                    />
                    <button
                      onClick={handleListOllamaModels}
                      disabled={ollamaModelsLoading}
                      className="h-8 shrink-0 rounded-md border border-foreground/10 bg-background px-3 text-xs font-medium text-foreground transition-colors hover:border-foreground/20 hover:bg-foreground/[0.03]"
                    >
                      {ollamaModelsLoading ? "Loading..." : "List"}
                    </button>
                  </div>
                  {ollamaModels.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {ollamaModels.map((model) => (
                        <button
                          key={model}
                          onClick={() => {
                            setOllamaDefaultModel(model);
                            handleOllamaDefaultModelSave(model);
                          }}
                          className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                            ollamaDefaultModel === model
                              ? "bg-accent text-accent-foreground"
                              : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                          }`}
                        >
                          {model}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </SettingRow>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
});
