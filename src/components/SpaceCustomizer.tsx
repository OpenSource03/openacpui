import { useState, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Shapes, Trash2 } from "lucide-react";
import { icons } from "lucide-react";
import { useResolvedTheme } from "@/hooks/useTheme";
import { SPACE_COLOR_PRESETS } from "@/hooks/useSpaceManager";
import type { SpaceColor } from "@/types";

// ── Expanded curated emoji set (~160 emojis) ──

export const CURATED_EMOJIS = [
  // Stars & sparkles (most popular for spaces — lead with these)
  "⭐", "🌟", "✨", "💫", "🌠", "⚡", "🔥", "💥",
  // Smileys & people
  "😀", "😎", "🤓", "🧑‍💻", "👾", "🤖", "👻", "💀",
  "😈", "🥸", "🤩", "😇", "🫡", "🥳", "🤠", "👽",
  // Hearts & symbols
  "❤️", "💜", "💙", "💚", "💛", "🧡", "🩷", "🖤",
  "🩵", "🤍", "💝", "💖", "♾️", "☯️", "🔮", "🧿",
  // Nature & weather
  "🌈", "🌊", "🍀", "🌸", "🌺", "🌻", "🌿", "🍂",
  "🌙", "☀️", "🌤️", "⛈️", "❄️", "🌪️", "🔆", "🌕",
  // Animals
  "🐱", "🐶", "🦊", "🐻", "🐼", "🦁", "🐸", "🦋",
  "🐝", "🦄", "🐙", "🐬", "🦅", "🐺", "🦎", "🐢",
  // Food & drink
  "☕", "🍕", "🍔", "🌮", "🍩", "🧁", "🍎", "🍑",
  "🍣", "🥐", "🍷", "🧋", "🫐", "🍒", "🥑", "🍜",
  // Objects & tools
  "🚀", "💎", "🎯", "🎨", "🎵", "📦", "💡", "🔔",
  "🏆", "🎮", "🎲", "📌", "🔑", "🛡️", "⚙️", "🔧",
  "📐", "🧪", "💻", "🖥️", "📱", "🔬", "🧲", "📡",
  // Activities & sports
  "🎭", "🎬", "🎪", "🎸", "🎤", "🎧", "🎾", "🏀",
  // Travel & places
  "🏠", "🏔️", "🌍", "🏝️", "🗼", "🏗️", "🌋", "🗺️",
  // Symbols & misc
  "🌀", "📚", "🧬", "🔒", "🏴‍☠️", "🚩", "🏁", "🎌",
  "💧", "🪐", "🛸", "🧊", "🫧", "🪩", "🎀", "🪬",
];

// ── Popular lucide icons ──

const POPULAR_ICONS = [
  "Layers", "Rocket", "Code", "Terminal", "Globe", "Heart", "Star", "Zap",
  "Shield", "Target", "Compass", "Flame", "Gem", "Crown", "Coffee", "Music",
  "Camera", "Book", "Briefcase", "Cpu", "Database", "Feather", "Gift", "Home",
  "Key", "Lamp", "Map", "Palette", "PenTool", "Puzzle", "Scissors", "Settings",
  "Sparkles", "Sun", "Umbrella", "Wand", "Wrench", "Box", "Cloud", "Flag",
];

// ── Color helpers ──

function getSwatchBg(preset: SpaceColor, isDark: boolean): string {
  if (preset.chroma === 0) return isDark ? "oklch(0.5 0 0)" : "oklch(0.55 0 0)";
  const lightness = isDark ? 0.55 : 0.62;
  return `oklch(${lightness} ${preset.chroma} ${preset.hue})`;
}

// ── Props ──

interface SpaceCustomizerProps {
  icon: string;
  iconType: "emoji" | "lucide";
  color: SpaceColor;
  onUpdateIcon: (icon: string, iconType: "emoji" | "lucide") => void;
  onUpdateColor: (color: SpaceColor) => void;
  /** When provided, show name input and delete button (edit mode) */
  editMode?: {
    name: string;
    onUpdateName: (name: string) => void;
    onDelete?: () => void;
  };
}

// ── Component ──

export function SpaceCustomizer({
  icon,
  iconType,
  color,
  onUpdateIcon,
  onUpdateColor,
  editMode,
}: SpaceCustomizerProps) {
  const [showIcons, setShowIcons] = useState(iconType === "lucide");
  const [iconSearch, setIconSearch] = useState("");
  const resolvedTheme = useResolvedTheme();
  const isDark = resolvedTheme === "dark";

  const useGradient = color.gradientHue !== undefined;

  const filteredIcons = useMemo(() => {
    const allNames = Object.keys(icons);
    if (!iconSearch) return POPULAR_ICONS.filter((n) => allNames.includes(n));
    const q = iconSearch.toLowerCase();
    return allNames.filter((n) => n.toLowerCase().includes(q)).slice(0, 80);
  }, [iconSearch]);

  const handleSelectColor = useCallback(
    (preset: SpaceColor) => {
      // Preserve gradient and opacity from current color
      onUpdateColor({
        ...preset,
        gradientHue: useGradient ? (preset.hue + 120) % 360 : undefined,
        opacity: color.opacity,
      });
    },
    [onUpdateColor, color.opacity, useGradient],
  );

  const hasColor = color.chroma > 0;

  return (
    <div className="flex flex-col gap-3">
      {/* ── Name input (edit mode only) ── */}
      {editMode && (
        <Input
          value={editMode.name}
          onChange={(e) => editMode.onUpdateName(e.target.value)}
          placeholder="Space name"
          className="h-8 text-sm"
          autoFocus
        />
      )}

      {/* ── Icon section ── */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            {showIcons ? "Icon" : "Emoji"}
          </span>
          <button
            onClick={() => {
              setShowIcons(!showIcons);
              setIconSearch("");
            }}
            className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            {showIcons ? (
              "Use emoji"
            ) : (
              <span className="inline-flex items-center gap-1">
                <Shapes className="h-3 w-3" />
                Icons
              </span>
            )}
          </button>
        </div>

        {showIcons ? (
          <div className="space-y-1.5">
            <Input
              placeholder="Search icons..."
              value={iconSearch}
              onChange={(e) => setIconSearch(e.target.value)}
              className="h-7 text-xs"
            />
            <ScrollArea className="h-[160px]">
              <div className="grid grid-cols-8 gap-0.5 p-0.5">
                {filteredIcons.map((iconName) => {
                  const LucideIcon = icons[iconName as keyof typeof icons];
                  if (!LucideIcon) return null;
                  const isSelected =
                    iconType === "lucide" &&
                    icon.toLowerCase() === iconName.toLowerCase();
                  return (
                    <button
                      key={iconName}
                      onClick={() => onUpdateIcon(iconName, "lucide")}
                      title={iconName}
                      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:bg-accent hover:scale-110 ${
                        isSelected ? "bg-accent ring-2 ring-ring scale-105" : ""
                      }`}
                    >
                      <LucideIcon className="h-4 w-4" />
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        ) : (
          <ScrollArea className="h-[180px]">
            <div className="grid grid-cols-8 gap-0.5 p-0.5">
              {CURATED_EMOJIS.map((emoji) => {
                const isSelected = icon === emoji && iconType === "emoji";
                return (
                  <button
                    key={emoji}
                    onClick={() => onUpdateIcon(emoji, "emoji")}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg text-base transition-all hover:bg-accent hover:scale-110 ${
                      isSelected ? "bg-accent ring-2 ring-ring scale-105" : ""
                    }`}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* ── Color section ── */}
      <div className="space-y-2.5">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          Color
        </span>

        {/* Preset swatches */}
        <div className="flex items-center justify-between gap-1.5">
          {SPACE_COLOR_PRESETS.map((preset, i) => {
            const isActive =
              color.hue === preset.hue && color.chroma === preset.chroma;
            return (
              <button
                key={i}
                onClick={() => handleSelectColor(preset)}
                className={`h-6 w-6 rounded-full transition-all hover:scale-110 shrink-0 ${
                  isActive
                    ? "ring-2 ring-foreground ring-offset-2 ring-offset-popover scale-110"
                    : "ring-1 ring-black/10 dark:ring-white/15"
                }`}
                style={{ background: getSwatchBg(preset, isDark) }}
              />
            );
          })}
        </div>

        {/* Hue slider with spectrum bar */}
        {hasColor && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Hue</span>
              <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                {color.hue}&deg;
              </span>
            </div>
            <div
              className="h-2 rounded-full"
              style={{
                background:
                  "linear-gradient(to right, oklch(0.65 0.15 0), oklch(0.65 0.15 60), oklch(0.65 0.15 120), oklch(0.65 0.15 180), oklch(0.65 0.15 240), oklch(0.65 0.15 300), oklch(0.65 0.15 360))",
              }}
            />
            <Slider
              min={0}
              max={360}
              step={1}
              value={[color.hue]}
              onValueChange={([hue]) =>
                onUpdateColor({
                  ...color,
                  hue,
                  gradientHue: useGradient
                    ? (color.gradientHue! + (hue - color.hue) + 360) % 360
                    : undefined,
                })
              }
            />
          </div>
        )}

        {/* Intensity slider */}
        {hasColor && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Intensity</span>
              <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                {Math.round(color.chroma * 100)}%
              </span>
            </div>
            <Slider
              min={0}
              max={0.3}
              step={0.01}
              value={[color.chroma]}
              onValueChange={([chroma]) =>
                onUpdateColor({ ...color, chroma })
              }
            />
          </div>
        )}

        {/* Gradient toggle */}
        {hasColor && (
          <div className="flex items-center gap-2.5">
            <Switch
              checked={useGradient}
              onCheckedChange={(next) =>
                onUpdateColor({
                  ...color,
                  gradientHue: next ? (color.hue + 120) % 360 : undefined,
                })
              }
              size="sm"
            />
            <span className="text-xs text-muted-foreground">Gradient</span>
          </div>
        )}

        {/* Gradient hue slider */}
        {hasColor && useGradient && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Gradient Hue</span>
              <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                {color.gradientHue ?? 180}&deg;
              </span>
            </div>
            <Slider
              min={0}
              max={360}
              step={1}
              value={[color.gradientHue ?? 180]}
              onValueChange={([gradientHue]) =>
                onUpdateColor({ ...color, gradientHue })
              }
            />
          </div>
        )}

        {/* Opacity slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Opacity</span>
            <span className="text-[10px] text-muted-foreground/60 tabular-nums">
              {Math.round((color.opacity ?? 1) * 100)}%
            </span>
          </div>
          <Slider
            min={0.2}
            max={1}
            step={0.05}
            value={[color.opacity ?? 1]}
            onValueChange={([opacity]) =>
              onUpdateColor({ ...color, opacity })
            }
          />
        </div>
      </div>

      {/* ── Delete button (edit mode, non-default spaces) ── */}
      {editMode?.onDelete && (
        <button
          onClick={editMode.onDelete}
          className="flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-destructive transition-colors pt-0.5"
        >
          <Trash2 className="h-3 w-3" />
          Delete space
        </button>
      )}
    </div>
  );
}
