import { memo, useState, useCallback, useEffect } from "react";
import { Bell, Volume2, MonitorSmartphone } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingRow, SettingsSelect, SettingsHeader, SettingsSection } from "@/components/settings/shared";
import type {
  NotificationTrigger,
  NotificationEventSettings,
  NotificationSettings,
  AppSettings,
} from "@/types";

// ── Props ──

interface NotificationsSettingsProps {
  appSettings: AppSettings | null;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

// ── Event type labels ──

const EVENT_GROUPS: Array<{
  key: keyof NotificationSettings;
  label: string;
  description: string;
}> = [
  {
    key: "sessionComplete",
    label: "Session Complete",
    description:
      "When Claude finishes processing and the session becomes idle.",
  },
  {
    key: "exitPlanMode",
    label: "Exit Plan Mode",
    description:
      "When Claude finishes planning and is ready to implement.",
  },
  {
    key: "permissions",
    label: "Permission Request",
    description:
      "When Claude needs approval to run a command, edit a file, etc.",
  },
  {
    key: "askUserQuestion",
    label: "Ask User Question",
    description: "When Claude asks you a question to guide the work.",
  },
];

const TRIGGER_OPTIONS: Array<{ value: NotificationTrigger; label: string }> = [
  { value: "always", label: "Always" },
  { value: "unfocused", label: "When Unfocused" },
  { value: "never", label: "Never" },
];

// ── Component ──

export const NotificationsSettings = memo(function NotificationsSettings({
  appSettings,
  onUpdateAppSettings,
}: NotificationsSettingsProps) {
  const [settings, setSettings] = useState<NotificationSettings>({
    exitPlanMode: { osNotification: "unfocused", sound: "always" },
    permissions: { osNotification: "unfocused", sound: "unfocused" },
    askUserQuestion: { osNotification: "unfocused", sound: "always" },
    sessionComplete: { osNotification: "unfocused", sound: "always" },
  });

  // Sync from loaded AppSettings
  useEffect(() => {
    if (appSettings?.notifications) {
      setSettings(appSettings.notifications);
    }
  }, [appSettings]);

  const updateEventSetting = useCallback(
    async (
      eventKey: keyof NotificationSettings,
      field: keyof NotificationEventSettings,
      value: NotificationTrigger,
    ) => {
      const updated: NotificationSettings = {
        ...settings,
        [eventKey]: { ...settings[eventKey], [field]: value },
      };
      setSettings(updated); // optimistic
      await onUpdateAppSettings({ notifications: updated });
    },
    [settings, onUpdateAppSettings],
  );

  return (
    <div className="flex h-full flex-col">
      <SettingsHeader
        title="Notifications"
        description="Configure when OS notifications and sounds play for different events."
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          {EVENT_GROUPS.map((event, i) => (
            <SettingsSection key={event.key} icon={Bell} label={event.label} first={i === 0}>
              <p className="mb-2 text-xs text-muted-foreground">
                {event.description}
              </p>

              {/* Two setting rows per event: OS notification + sound */}
              <div className="flex flex-col">
                <SettingRow label="OS Notification">
                  <div className="flex items-center gap-1.5">
                    <MonitorSmartphone className="h-3.5 w-3.5 text-muted-foreground/50" />
                    <SettingsSelect
                      value={settings[event.key].osNotification}
                      onValueChange={(v) =>
                        updateEventSetting(event.key, "osNotification", v)
                      }
                      options={TRIGGER_OPTIONS}
                    />
                  </div>
                </SettingRow>

                <SettingRow label="Sound">
                  <div className="flex items-center gap-1.5">
                    <Volume2 className="h-3.5 w-3.5 text-muted-foreground/50" />
                    <SettingsSelect
                      value={settings[event.key].sound}
                      onValueChange={(v) =>
                        updateEventSetting(event.key, "sound", v)
                      }
                      options={TRIGGER_OPTIONS}
                    />
                  </div>
                </SettingRow>
              </div>
            </SettingsSection>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
});
