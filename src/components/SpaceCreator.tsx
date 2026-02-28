import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { X, Smile, Shapes } from "lucide-react";
import { icons } from "lucide-react";
import { resolveLucideIcon } from "@/lib/icon-utils";
import type { Space, SpaceColor } from "@/types";

// ── Curated emoji set ──

const CURATED_EMOJIS = [
  "😀", "😎", "🤓", "🧑‍💻", "👾", "🤖", "👻", "💀",
  "🌟", "⭐", "🔥", "💧", "🌈", "🌊", "🍀", "🌸",
  "🚀", "💎", "🎯", "🎨", "🎵", "📦", "🔮", "💡",
  "⚡", "🔔", "🏆", "🎮", "🎲", "📌", "🔑", "🛡️",
  "❤️", "💜", "💙", "💚", "💛", "🧡", "🩷", "🖤",
  "✨", "💫", "🌀", "♾️", "⚙️", "🔧", "📐", "🧪",
  "🐱", "🐶", "🦊", "🐻", "🐼", "🦁", "🐸", "🦋",
  "☕", "🍕", "🍔", "🌮", "🍩", "🧁", "🍎", "🍑",
  "🏠", "🏔️", "🌍", "🏝️", "🌙", "☀️", "⛈️", "🌤️",
  "📚", "💻", "🖥️", "📱", "🎪", "🏗️", "🧲", "🔬",
  "🎭", "🎬", "📡", "🧬", "🔒", "🏴‍☠️", "🚩", "🏁",
];

// ── Popular lucide icons (PascalCase keys) ──

const POPULAR_ICONS = [
  "Layers", "Rocket", "Code", "Terminal", "Globe", "Heart", "Star", "Zap",
  "Shield", "Target", "Compass", "Flame", "Gem", "Crown", "Coffee", "Music",
  "Camera", "Book", "Briefcase", "Cpu", "Database", "Feather", "Gift", "Home",
  "Key", "Lamp", "Map", "Palette", "PenTool", "Puzzle", "Scissors", "Settings",
  "Sparkles", "Sun", "Umbrella", "Wand", "Wrench", "Box", "Cloud", "Flag",
];

// ── Color presets ──

const COLOR_PRESETS: SpaceColor[] = [
  { hue: 0, chroma: 0 },
  { hue: 15, chroma: 0.15 },
  { hue: 45, chroma: 0.15 },
  { hue: 85, chroma: 0.15 },
  { hue: 150, chroma: 0.15 },
  { hue: 200, chroma: 0.15 },
  { hue: 260, chroma: 0.15 },
  { hue: 300, chroma: 0.15 },
  { hue: 340, chroma: 0.15 },
];

// ── Color helpers ──

function getPreviewBg(color: SpaceColor): string {
  if (color.chroma === 0) return "oklch(0.4 0 0)";
  const c = Math.min(color.chroma, 0.18);
  if (color.gradientHue !== undefined) {
    return `linear-gradient(135deg, oklch(0.52 ${c} ${color.hue}), oklch(0.48 ${c} ${color.gradientHue}))`;
  }
  return `oklch(0.52 ${c} ${color.hue})`;
}

function getPresetBg(preset: SpaceColor): string {
  if (preset.chroma === 0) return "oklch(0.5 0 0)";
  return `oklch(0.6 ${preset.chroma} ${preset.hue})`;
}

// ── Props ──

interface SpaceCreatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingSpace?: Space | null;
  onSave: (name: string, icon: string, iconType: "emoji" | "lucide", color: SpaceColor) => void;
}

// ── Component ──

export function SpaceCreator({ open, onOpenChange, editingSpace, onSave }: SpaceCreatorProps) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("Layers");
  const [iconType, setIconType] = useState<"emoji" | "lucide">("lucide");
  const [color, setColor] = useState<SpaceColor>({ hue: 260, chroma: 0.15 });
  const [iconSearch, setIconSearch] = useState("");
  const [useGradient, setUseGradient] = useState(false);

  // Reset form when dialog opens or switches between create/edit
  useEffect(() => {
    if (editingSpace) {
      setName(editingSpace.name);
      setIcon(editingSpace.icon);
      setIconType(editingSpace.iconType);
      setColor(editingSpace.color);
      setUseGradient(editingSpace.color.gradientHue !== undefined);
    } else {
      setName("");
      setIcon("Layers");
      setIconType("lucide");
      setColor({ hue: 260, chroma: 0.15 });
      setUseGradient(false);
    }
    setIconSearch("");
  }, [editingSpace, open]);

  const filteredIcons = useMemo(() => {
    const allNames = Object.keys(icons);
    if (!iconSearch) return POPULAR_ICONS.filter((n) => allNames.includes(n));
    const q = iconSearch.toLowerCase();
    return allNames.filter((n) => n.toLowerCase().includes(q)).slice(0, 80);
  }, [iconSearch]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, icon, iconType, color);
    onOpenChange(false);
  };

  const isEditing = !!editingSpace;
  const previewBg = getPreviewBg(color);
  const isGradientBg = previewBg.startsWith("linear");

  // Render selected icon for the hero preview
  const renderPreviewIcon = () => {
    if (iconType === "emoji") {
      return <span className="text-3xl leading-none drop-shadow-sm">{icon}</span>;
    }
    const Icon = resolveLucideIcon(icon);
    if (!Icon) return <span className="text-3xl">?</span>;
    return <Icon className="h-7 w-7 text-white drop-shadow-sm" />;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-sm max-h-[calc(100dvh-3rem)] flex flex-col gap-0 p-0 overflow-hidden"
        showCloseButton={false}
      >
        {/* ── Hero preview — live color/icon/name preview ── */}
        <div
          className="relative flex flex-col items-center justify-center shrink-0 px-6 pt-9 pb-6"
          style={{
            background: isGradientBg ? previewBg : undefined,
            backgroundColor: !isGradientBg ? previewBg : undefined,
          }}
        >
          {/* Radial light wash for depth */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse at 30% 25%, rgba(255,255,255,0.2) 0%, transparent 60%)",
            }}
          />

          {/* Close button — glassmorphic circle */}
          <button
            onClick={() => onOpenChange(false)}
            className="absolute top-2.5 end-2.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white/50 hover:bg-white/20 hover:text-white/80 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>

          {/* Mode label */}
          <span className="absolute top-3 start-4 text-[11px] font-medium text-white/40 uppercase tracking-widest select-none">
            {isEditing ? "Edit" : "New"}
          </span>

          {/* Floating icon container */}
          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm ring-1 ring-white/20 shadow-lg">
            {renderPreviewIcon()}
          </div>

          {/* Name preview */}
          <p className="relative mt-3 text-sm font-medium text-white/90 truncate max-w-full">
            {name.trim() || "Untitled Space"}
          </p>
        </div>

        {/* ── Scrollable form body ── */}
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Work, Personal, Side Project"
              className="h-9"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
              autoFocus
            />
          </div>

          {/* Icon picker — emoji and lucide tabs */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              Icon
            </label>
            <Tabs
              defaultValue={iconType === "emoji" ? "emoji" : "icons"}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-2 h-8">
                <TabsTrigger value="emoji" className="text-xs gap-1">
                  <Smile className="h-3.5 w-3.5" />
                  Emoji
                </TabsTrigger>
                <TabsTrigger value="icons" className="text-xs gap-1">
                  <Shapes className="h-3.5 w-3.5" />
                  Icons
                </TabsTrigger>
              </TabsList>

              <TabsContent value="emoji" className="mt-2">
                <ScrollArea className="h-[152px]">
                  <div className="grid grid-cols-8 gap-1 p-0.5">
                    {CURATED_EMOJIS.map((emoji) => {
                      const isSelected = icon === emoji && iconType === "emoji";
                      return (
                        <button
                          key={emoji}
                          onClick={() => {
                            setIcon(emoji);
                            setIconType("emoji");
                          }}
                          className={`flex h-8 w-8 items-center justify-center rounded-lg text-base transition-all hover:bg-accent hover:scale-110 ${
                            isSelected
                              ? "bg-accent ring-2 ring-ring scale-105"
                              : ""
                          }`}
                        >
                          {emoji}
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="icons" className="mt-2 space-y-2">
                <Input
                  placeholder="Search icons…"
                  value={iconSearch}
                  onChange={(e) => setIconSearch(e.target.value)}
                  className="h-8 text-xs"
                />
                <ScrollArea className="h-[152px]">
                  <div className="grid grid-cols-8 gap-1 p-0.5">
                    {filteredIcons.map((iconName) => {
                      const LucideIcon = icons[iconName as keyof typeof icons];
                      if (!LucideIcon) return null;
                      const isSelected =
                        iconType === "lucide" &&
                        icon.toLowerCase() === iconName.toLowerCase();
                      return (
                        <button
                          key={iconName}
                          onClick={() => {
                            setIcon(iconName);
                            setIconType("lucide");
                          }}
                          title={iconName}
                          className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:bg-accent hover:scale-110 ${
                            isSelected
                              ? "bg-accent ring-2 ring-ring scale-105"
                              : ""
                          }`}
                        >
                          <LucideIcon className="h-4 w-4" />
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>

          {/* Color picker */}
          <div className="space-y-3">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              Color
            </label>

            {/* Preset swatches */}
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map((preset, i) => {
                const isActive =
                  color.hue === preset.hue && color.chroma === preset.chroma;
                return (
                  <button
                    key={i}
                    onClick={() => {
                      setColor({
                        ...preset,
                        gradientHue: useGradient
                          ? (preset.hue + 120) % 360
                          : undefined,
                        opacity: color.opacity, // preserve current opacity on preset click
                      });
                    }}
                    className={`h-7 w-7 rounded-full transition-all hover:scale-110 ${
                      isActive
                        ? "ring-2 ring-foreground ring-offset-2 ring-offset-background scale-110"
                        : "ring-1 ring-border"
                    }`}
                    style={{ background: getPresetBg(preset) }}
                  />
                );
              })}
            </div>

            {/* Hue slider with spectrum bar */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Hue</span>
                <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                  {color.hue}&deg;
                </span>
              </div>
              <div
                className="h-2.5 rounded-full"
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
                onValueChange={([hue]) => setColor({ ...color, hue })}
              />
            </div>

            {/* Intensity slider */}
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
                onValueChange={([chroma]) => setColor({ ...color, chroma })}
              />
            </div>

            {/* Gradient toggle */}
            <div className="flex items-center gap-2.5">
              <Switch
                checked={useGradient}
                onCheckedChange={(next) => {
                  setUseGradient(next);
                  setColor({
                    ...color,
                    gradientHue: next ? (color.hue + 120) % 360 : undefined,
                  });
                }}
                size="sm"
              />
              <span className="text-xs text-muted-foreground">Gradient</span>
            </div>

            {/* Gradient hue slider — shown when gradient is enabled */}
            {useGradient && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Gradient Hue
                  </span>
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
                    setColor({ ...color, gradientHue })
                  }
                />
              </div>
            )}

            {/* Opacity slider — controls island background transparency */}
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
                onValueChange={([opacity]) => setColor({ ...color, opacity })}
              />
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!name.trim()}
            style={
              color.chroma > 0
                ? {
                    backgroundColor: `oklch(0.55 ${Math.min(color.chroma, 0.15)} ${color.hue})`,
                    color: "white",
                  }
                : undefined
            }
          >
            {isEditing ? "Save Changes" : "Create Space"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
