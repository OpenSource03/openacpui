import { memo, useState, useCallback, useEffect } from "react";
import { Server } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

// ── Types ──

interface AppSettings {
  codexClientName: string;
}

interface AdvancedSettingsProps {
  appSettings: AppSettings | null;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

// ── Setting row helper ──

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ── Component ──

export const AdvancedSettings = memo(function AdvancedSettings({
  appSettings,
  onUpdateAppSettings,
}: AdvancedSettingsProps) {
  const [codexClientName, setCodexClientName] = useState("Harnss");

  useEffect(() => {
    if (appSettings) {
      setCodexClientName(appSettings.codexClientName || "Harnss");
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

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-foreground/[0.06] px-6 py-4">
        <h2 className="text-base font-semibold text-foreground">Advanced</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Low-level settings for protocol behavior and server communication
        </p>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          {/* ── Codex Server section ── */}
          <div className="py-3">
            <div className="mb-1 flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Codex Server
              </span>
            </div>

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
          </div>
        </div>
      </ScrollArea>
    </div>
  );
});
