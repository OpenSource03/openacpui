import { useState, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Trash2 } from "lucide-react";
import { icons } from "lucide-react";
import { useResolvedTheme } from "@/hooks/useTheme";
import { SPACE_COLOR_PRESETS } from "@/hooks/useSpaceManager";
import type { SpaceColor } from "@/types";
import { CURATED_EMOJIS, CURATED_LUCIDE_ICONS } from "@/lib/icon-catalog";
import { SIMPLE_ICON_GROUPS, SIMPLE_ICON_SLUGS } from "@/lib/simple-icon-catalog";
import { SimpleIconGlyph } from "@/components/SimpleIconGlyph";

// Re-export so existing consumers importing from this file keep working.
export { CURATED_EMOJIS };

// ── Color helpers ──

function getSwatchBg(preset: SpaceColor, isDark: boolean): string {
  if (preset.chroma === 0) return isDark ? "oklch(0.5 0 0)" : "oklch(0.55 0 0)";
  const lightness = isDark ? 0.55 : 0.62;
  return `oklch(${lightness} ${preset.chroma} ${preset.hue})`;
}

// ── Props ──

interface SpaceCustomizerProps {
  icon: string;
  iconType: "emoji" | "lucide" | "simple";
  color: SpaceColor;
  onUpdateIcon: (icon: string, iconType: "emoji" | "lucide" | "simple") => void;
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
  const initialMode: "emoji" | "lucide" | "simple" =
    iconType === "simple" ? "simple" : iconType === "lucide" ? "lucide" : "emoji";
  const [mode, setMode] = useState<"emoji" | "lucide" | "simple">(initialMode);
  const [iconSearch, setIconSearch] = useState("");
  const [brandSearch, setBrandSearch] = useState("");
  const resolvedTheme = useResolvedTheme();
  const isDark = resolvedTheme === "dark";

  const useGradient = color.gradientHue !== undefined;

  const filteredIcons = useMemo(() => {
    const allNames = Object.keys(icons);
    const allNameSet = new Set(allNames);
    if (!iconSearch) return CURATED_LUCIDE_ICONS.filter((n) => allNameSet.has(n));
    const q = iconSearch.toLowerCase();
    return allNames.filter((n) => n.toLowerCase().includes(q)).slice(0, 200);
  }, [iconSearch]);

  const filteredBrands = useMemo(() => {
    if (!brandSearch) return null;
    const q = brandSearch.toLowerCase();
    return SIMPLE_ICON_SLUGS.filter((s) => s.includes(q));
  }, [brandSearch]);

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
        {/* Segmented 3-way switch: Emoji / Icons / Brands */}
        <div className="grid grid-cols-3 gap-0.5 rounded-md bg-muted/40 p-0.5 text-[11px]">
          {([
            { id: "emoji", label: "Emoji" },
            { id: "lucide", label: "Icons" },
            { id: "simple", label: "Brands" },
          ] as const).map((opt) => (
            <button
              key={opt.id}
              onClick={() => setMode(opt.id)}
              className={`rounded px-2 py-1 transition-colors ${
                mode === opt.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {mode === "lucide" ? (
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
        ) : mode === "simple" ? (
          <div className="space-y-1.5">
            <Input
              placeholder="Search brands..."
              value={brandSearch}
              onChange={(e) => setBrandSearch(e.target.value)}
              className="h-7 text-xs"
            />
            <ScrollArea className="h-[160px]">
              {filteredBrands ? (
                <div className="grid grid-cols-8 gap-0.5 p-0.5">
                  {filteredBrands.map((slug) => {
                    const isSelected = iconType === "simple" && icon === slug;
                    return (
                      <button
                        key={slug}
                        onClick={() => onUpdateIcon(slug, "simple")}
                        title={slug}
                        className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:bg-accent hover:scale-110 ${
                          isSelected ? "bg-accent ring-2 ring-ring scale-105" : ""
                        }`}
                      >
                        <SimpleIconGlyph slug={slug} size={16} />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-2 p-0.5">
                  {SIMPLE_ICON_GROUPS.map((group) => (
                    <div key={group.label}>
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {group.label}
                      </p>
                      <div className="grid grid-cols-8 gap-0.5">
                        {group.icons.map((brand) => {
                          const isSelected =
                            iconType === "simple" && icon === brand.slug;
                          return (
                            <button
                              key={brand.slug}
                              onClick={() => onUpdateIcon(brand.slug, "simple")}
                              title={brand.title}
                              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:bg-accent hover:scale-110 ${
                                isSelected ? "bg-accent ring-2 ring-ring scale-105" : ""
                              }`}
                            >
                              <SimpleIconGlyph slug={brand.slug} size={16} />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
