import { useEffect, useState } from "react";
import { toast } from "sonner";
import { isMac } from "@/lib/utils";
import type { MacBackgroundEffect, ThemeOption } from "@/types";

type MacNativeBackgroundEffect = Exclude<MacBackgroundEffect, "off">;

const MAC_BACKGROUND_EFFECT_RESTART_TOAST_ID = "mac-background-effect-restart";

interface UseGlassOrchestratorOptions {
  /** User's desired macOS background effect from settings */
  macBackgroundEffect: MacBackgroundEffect;
  /** Setter to downgrade the effect when liquid glass is unsupported */
  setMacBackgroundEffect: (effect: MacBackgroundEffect) => void;
  /** Whether the user has window transparency enabled */
  transparency: boolean;
  /** Current theme selection (synced to Electron's nativeTheme for Windows Mica) */
  theme: ThemeOption;
}

interface GlassOrchestratorState {
  glassSupported: boolean;
  macLiquidGlassSupported: boolean;
  liveMacBackgroundEffect: MacNativeBackgroundEffect;
}

/**
 * Manages glass/transparency effects across macOS and Windows:
 * - Detects glass and liquid glass support
 * - Applies or upgrades the native background effect at runtime
 * - Shows a restart toast when downgrading from liquid-glass to vibrancy
 * - Auto-falls back to vibrancy when liquid glass is unsupported
 * - Toggles the `glass-enabled` CSS class on the document root
 * - Keeps Electron's nativeTheme in sync for Windows Mica
 */
export function useGlassOrchestrator({
  macBackgroundEffect,
  setMacBackgroundEffect,
  transparency,
  theme,
}: UseGlassOrchestratorOptions): GlassOrchestratorState {
  const [glassSupported, setGlassSupported] = useState(false);
  const [macLiquidGlassSupported, setMacLiquidGlassSupported] = useState<boolean | null>(null);

  // The effect the main process is *actually* rendering right now.
  // Can upgrade vibrancy -> liquid-glass at runtime, but NOT the reverse (requires restart).
  // Seeded from AppSettings on mount.
  const [liveMacBackgroundEffect, setLiveMacBackgroundEffect] = useState<MacNativeBackgroundEffect>("liquid-glass");

  // Detect glass and liquid-glass support on mount; seed live effect from AppSettings.
  useEffect(() => {
    window.claude.getGlassSupported().then((supported) => setGlassSupported(supported));
    window.claude.getMacBackgroundEffectSupport().then((support) => {
      setMacLiquidGlassSupported(!!support.liquidGlass);
    });
    if (!isMac) return;
    let cancelled = false;
    window.claude.settings.get().then((appSettings) => {
      if (cancelled) return;
      setLiveMacBackgroundEffect(
        appSettings?.macBackgroundEffect === "vibrancy" ? "vibrancy" : "liquid-glass",
      );
    }).catch(() => { /* keep default */ });
    return () => { cancelled = true; };
  }, []);

  // Keep Electron's native theme in sync so Windows Mica follows the app theme.
  useEffect(() => {
    window.claude.setThemeSource(theme);
  }, [theme]);

  // When the desired effect changes, apply it if the transition is safe at runtime.
  // Liquid-glass -> vibrancy requires restart; vibrancy -> liquid-glass is instant.
  useEffect(() => {
    if (!isMac) return;
    const desiredNativeEffect = macBackgroundEffect === "off"
      ? null
      : macBackgroundEffect;
    if (!desiredNativeEffect || desiredNativeEffect === liveMacBackgroundEffect) return;
    // Cannot downgrade from liquid-glass to vibrancy without restart.
    if (liveMacBackgroundEffect === "liquid-glass" && desiredNativeEffect === "vibrancy") return;

    setLiveMacBackgroundEffect(desiredNativeEffect);
    window.claude.setMacBackgroundEffect(desiredNativeEffect);
  }, [liveMacBackgroundEffect, macBackgroundEffect]);

  // Show restart toast when user wants vibrancy but live is liquid-glass.
  useEffect(() => {
    if (!isMac) return;
    const requiresRestart = macBackgroundEffect === "vibrancy"
      && liveMacBackgroundEffect === "liquid-glass";

    if (!requiresRestart) {
      toast.dismiss(MAC_BACKGROUND_EFFECT_RESTART_TOAST_ID);
      return;
    }

    toast("Restart required", {
      id: MAC_BACKGROUND_EFFECT_RESTART_TOAST_ID,
      duration: Infinity,
      description: "Restart Harnss to switch away from Liquid Glass cleanly.",
      action: {
        label: "Restart",
        onClick: () => {
          void window.claude.relaunchApp();
        },
      },
    });
  }, [liveMacBackgroundEffect, macBackgroundEffect]);

  // Auto-fallback: if this OS doesn't support liquid glass, downgrade to vibrancy.
  useEffect(() => {
    if (!isMac || macLiquidGlassSupported !== false) return;
    if (macBackgroundEffect !== "liquid-glass") return;
    setMacBackgroundEffect("vibrancy");
  }, [macLiquidGlassSupported, macBackgroundEffect, setMacBackgroundEffect]);

  // Toggle the glass-enabled CSS class when the transparency setting changes.
  // Preload applies the initial class from localStorage so first paint stays in sync.
  useEffect(() => {
    if (!glassSupported) return;
    const root = document.documentElement;
    if (transparency) {
      root.classList.add("glass-enabled");
    } else {
      root.classList.remove("glass-enabled");
    }
  }, [transparency, glassSupported]);

  return {
    glassSupported,
    macLiquidGlassSupported: macLiquidGlassSupported ?? false,
    liveMacBackgroundEffect,
  };
}
