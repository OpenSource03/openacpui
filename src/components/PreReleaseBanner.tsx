import { memo, useCallback, useEffect, useState } from "react";
import { FlaskConical, Settings } from "lucide-react";

interface PreReleaseBannerProps {
  onOpenSettings: () => void;
}

export const PreReleaseBanner = memo(function PreReleaseBanner({
  onOpenSettings,
}: PreReleaseBannerProps) {
  const [info, setInfo] = useState<PreReleaseInfo | null>(null);

  useEffect(() => {
    // Fetch on mount (uses cached result after first call)
    window.claude.updater.isPreRelease().then(setInfo);

    // Also listen for proactive push from main process
    const unsub = window.claude.updater.onPreReleaseStatus(setInfo);
    return unsub;
  }, []);

  const handleOpenSettings = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onOpenSettings();
    },
    [onOpenSettings],
  );

  if (!info?.isPreRelease) return null;

  return (
    <div className="mx-2 mb-1.5">
      <div className="flex flex-col gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-2 text-xs">
        <div className="flex items-start gap-2">
          <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sidebar-foreground/90">
              Pre-release version
            </p>
            <p className="mt-0.5 text-sidebar-foreground/60 leading-relaxed">
              v{info.version} is experimental and may contain bugs.{" "}
              <button
                onClick={handleOpenSettings}
                className="inline-flex items-center gap-0.5 text-sidebar-foreground/70 underline decoration-sidebar-foreground/30 underline-offset-2 transition-colors hover:text-sidebar-foreground hover:decoration-sidebar-foreground/50"
              >
                <Settings className="h-2.5 w-2.5" />
                Switch to stable
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
});
