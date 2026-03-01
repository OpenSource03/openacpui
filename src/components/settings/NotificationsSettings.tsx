import { memo, useState, useCallback, useEffect } from "react";
import { Bell, Volume2, MonitorSmartphone } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingRow, selectClass } from "@/components/settings/shared";
import type {
  NotificationTrigger,
  NotificationEventSettings,
  NotificationSettings,
  AppSettings,
} from "@/types/ui";

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
      {/* Header */}
      <div className="border-b border-foreground/[0.06] px-6 py-4">
        <h2 className="text-base font-semibold text-foreground">
          Notifications
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Configure when OS notifications and sounds play for different events.
        </p>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          {EVENT_GROUPS.map((event, i) => (
            <div
              key={event.key}
              className={`py-3 ${i > 0 ? "border-t border-foreground/[0.04]" : ""}`}
            >
              {/* Event group header */}
              <div className="mb-1 flex items-center gap-2">
                <Bell className="h-4 w-4 text-muted-foreground" />
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {event.label}
                </span>
              </div>
              <p className="mb-2 text-xs text-muted-foreground">
                {event.description}
              </p>

              {/* Two setting rows per event: OS notification + sound */}
              <div className="flex flex-col">
                <SettingRow label="OS Notification">
                  <div className="flex items-center gap-1.5">
                    <MonitorSmartphone className="h-3.5 w-3.5 text-muted-foreground/50" />
                    <select
                      value={settings[event.key].osNotification}
                      onChange={(e) =>
                        updateEventSetting(
                          event.key,
                          "osNotification",
                          e.target.value as NotificationTrigger,
                        )
                      }
                      className={selectClass}
                    >
                      {TRIGGER_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </SettingRow>

                <SettingRow label="Sound">
                  <div className="flex items-center gap-1.5">
                    <Volume2 className="h-3.5 w-3.5 text-muted-foreground/50" />
                    <select
                      value={settings[event.key].sound}
                      onChange={(e) =>
                        updateEventSetting(
                          event.key,
                          "sound",
                          e.target.value as NotificationTrigger,
                        )
                      }
                      className={selectClass}
                    >
                      {TRIGGER_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </SettingRow>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
});
