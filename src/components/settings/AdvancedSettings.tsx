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
  const [openclawGatewayUrl, setOpenclawGatewayUrl] = useState("ws://127.0.0.1:18789");
  const [openclawDefaultModel, setOpenclawDefaultModel] = useState("");
  const [openclawDefaultSkills, setOpenclawDefaultSkills] = useState("");
  const [openclawGatewayToken, setOpenclawGatewayToken] = useState("");
  const [gatewayTestStatus, setGatewayTestStatus] = useState<"idle" | "testing" | "connected" | "failed">("idle");
  const [gatewayTestError, setGatewayTestError] = useState<string | null>(null);
  const [pairStatus, setPairStatus] = useState<"idle" | "pairing" | "paired" | "failed">("idle");
  const [pairError, setPairError] = useState<string | null>(null);
  const [isPaired, setIsPaired] = useState(false);

  useEffect(() => {
    if (appSettings) {
      setCodexClientName(appSettings.codexClientName || "Harnss");
      setCodexBinarySource(appSettings.codexBinarySource || "auto");
      setCodexCustomBinaryPath(appSettings.codexCustomBinaryPath || "");
      setClaudeBinarySource(appSettings.claudeBinarySource || "auto");
      setClaudeCustomBinaryPath(appSettings.claudeCustomBinaryPath || "");
      setShowDevFillInChatTitleBar(!!appSettings.showDevFillInChatTitleBar);
      setShowJiraBoard(!!appSettings.showJiraBoard);
      setOpenclawGatewayUrl(appSettings.openclawGatewayUrl || "ws://127.0.0.1:18789");
      setOpenclawDefaultModel(appSettings.openclawDefaultModel || "");
      setOpenclawDefaultSkills((appSettings.openclawDefaultSkills ?? []).join(", "));
      setOpenclawGatewayToken(appSettings.openclawGatewayToken || "");
      setIsPaired(!!appSettings.openclawDeviceToken);
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

  const handleOpenclawGatewayUrlSave = useCallback(
    async (value: string) => {
      const next = value.trim() || "ws://127.0.0.1:18789";
      setOpenclawGatewayUrl(next);
      await onUpdateAppSettings({ openclawGatewayUrl: next });
    },
    [onUpdateAppSettings],
  );

  const handleOpenclawModelSave = useCallback(
    async (value: string) => {
      const next = value.trim();
      setOpenclawDefaultModel(next);
      await onUpdateAppSettings({ openclawDefaultModel: next });
    },
    [onUpdateAppSettings],
  );

  const handleOpenclawSkillsSave = useCallback(
    async (value: string) => {
      const next = value.trim();
      setOpenclawDefaultSkills(next);
      const skills = next ? next.split(",").map(s => s.trim()).filter(Boolean) : [];
      await onUpdateAppSettings({ openclawDefaultSkills: skills });
    },
    [onUpdateAppSettings],
  );

  const handleGatewayTokenSave = useCallback(
    async (value: string) => {
      const next = value.trim();
      setOpenclawGatewayToken(next);
      await onUpdateAppSettings({ openclawGatewayToken: next });
    },
    [onUpdateAppSettings],
  );

  const handleTestGateway = useCallback(async () => {
    setGatewayTestStatus("testing");
    setGatewayTestError(null);
    try {
      const result = await window.claude.openclaw.status();
      if (result.available) {
        setGatewayTestStatus("connected");
      } else {
        setGatewayTestStatus("failed");
        setGatewayTestError(result.error ?? "Connection failed");
      }
    } catch (err) {
      setGatewayTestStatus("failed");
      setGatewayTestError((err as Error).message || "Connection failed");
    }
    setTimeout(() => { setGatewayTestStatus("idle"); setGatewayTestError(null); }, 6000);
  }, []);

  const handlePair = useCallback(async () => {
    setPairStatus("pairing");
    setPairError(null);
    try {
      const result = await window.claude.openclaw.pair();
      if (result.ok) {
        setPairStatus("paired");
        setIsPaired(true);
      } else {
        setPairStatus("failed");
        setPairError(result.error ?? "Pairing failed");
      }
    } catch (err) {
      setPairStatus("failed");
      setPairError((err as Error).message || "Pairing failed");
    }
    setTimeout(() => { setPairStatus("idle"); setPairError(null); }, 6000);
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

          {/* ── OpenClaw section ── */}
          {section === "engines" && (
            <div className="py-3">
              <div className="mb-1 flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" />
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  OpenClaw
                </span>
                {isPaired && (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-px text-[10px] font-medium text-emerald-400">
                    Paired
                  </span>
                )}
              </div>

              <SettingRow
                label="Gateway URL"
                description="WebSocket address of the OpenClaw Gateway."
              >
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={openclawGatewayUrl}
                      onChange={(e) => setOpenclawGatewayUrl(e.target.value)}
                      onBlur={(e) => handleOpenclawGatewayUrlSave(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleOpenclawGatewayUrlSave(e.currentTarget.value);
                      }}
                      spellCheck={false}
                      className="h-8 w-64 rounded-md border border-foreground/10 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20"
                      placeholder="ws://127.0.0.1:18789"
                    />
                    <button
                      onClick={handleTestGateway}
                      disabled={gatewayTestStatus === "testing"}
                      className={`h-8 shrink-0 rounded-md border px-3 text-xs font-medium transition-colors ${
                        gatewayTestStatus === "connected"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                          : gatewayTestStatus === "failed"
                            ? "border-red-500/30 bg-red-500/10 text-red-400"
                            : "border-foreground/10 bg-background text-foreground hover:border-foreground/20 hover:bg-foreground/[0.03]"
                      }`}
                    >
                      {gatewayTestStatus === "testing" ? "Testing..." :
                       gatewayTestStatus === "connected" ? "Connected" :
                       gatewayTestStatus === "failed" ? "Failed" :
                       "Test"}
                    </button>
                  </div>
                  {gatewayTestError && (
                    <p className="text-[11px] text-red-400">{gatewayTestError}</p>
                  )}
                </div>
              </SettingRow>

              <SettingRow
                label="Gateway token"
                description="Auth token for the Gateway (OPENCLAW_GATEWAY_TOKEN). Leave empty if not required."
              >
                <input
                  type="password"
                  value={openclawGatewayToken}
                  onChange={(e) => setOpenclawGatewayToken(e.target.value)}
                  onBlur={(e) => handleGatewayTokenSave(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleGatewayTokenSave(e.currentTarget.value);
                  }}
                  spellCheck={false}
                  autoComplete="off"
                  className="h-8 w-64 rounded-md border border-foreground/10 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20"
                  placeholder="Optional gateway token"
                />
              </SettingRow>

              <SettingRow
                label="Device pairing"
                description={isPaired ? "This device is paired with the Gateway." : "Pair this device with the Gateway to establish a trusted connection."}
              >
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={handlePair}
                    disabled={pairStatus === "pairing"}
                    className={`h-8 rounded-md border px-4 text-xs font-medium transition-colors ${
                      pairStatus === "paired"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        : pairStatus === "failed"
                          ? "border-red-500/30 bg-red-500/10 text-red-400"
                          : "border-foreground/10 bg-background text-foreground hover:border-foreground/20 hover:bg-foreground/[0.03]"
                    }`}
                  >
                    {pairStatus === "pairing" ? "Pairing..." :
                     pairStatus === "paired" ? "Paired" :
                     pairStatus === "failed" ? "Failed" :
                     isPaired ? "Re-pair" : "Pair Device"}
                  </button>
                  {pairError && (
                    <p className="max-w-xs text-[11px] text-red-400">{pairError}</p>
                  )}
                </div>
              </SettingRow>

              <SettingRow
                label="Default model"
                description="Model identifier sent to the Gateway when starting new sessions."
              >
                <input
                  type="text"
                  value={openclawDefaultModel}
                  onChange={(e) => setOpenclawDefaultModel(e.target.value)}
                  onBlur={(e) => handleOpenclawModelSave(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleOpenclawModelSave(e.currentTarget.value);
                  }}
                  spellCheck={false}
                  className="h-8 w-60 rounded-md border border-foreground/10 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20"
                  placeholder="e.g. gpt-4o, claude-sonnet-4-6"
                />
              </SettingRow>

              <SettingRow
                label="Default skills"
                description="Comma-separated list of skills to enable by default (e.g. shell_exec, web_search)."
              >
                <input
                  type="text"
                  value={openclawDefaultSkills}
                  onChange={(e) => setOpenclawDefaultSkills(e.target.value)}
                  onBlur={(e) => handleOpenclawSkillsSave(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleOpenclawSkillsSave(e.currentTarget.value);
                  }}
                  spellCheck={false}
                  className="h-8 w-80 rounded-md border border-foreground/10 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20"
                  placeholder="shell_exec, file_read, web_search"
                />
              </SettingRow>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
});
