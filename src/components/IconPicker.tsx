import { useState, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { icons } from "lucide-react";
import { CURATED_EMOJIS, CURATED_LUCIDE_ICONS } from "@/lib/icon-catalog";
import { SIMPLE_ICON_GROUPS, SIMPLE_ICON_SLUGS } from "@/lib/simple-icon-catalog";
import { SimpleIconGlyph } from "@/components/SimpleIconGlyph";

interface IconPickerProps {
  value: string;
  iconType: "emoji" | "lucide" | "simple";
  onChange: (icon: string, type: "emoji" | "lucide" | "simple") => void;
}

export function IconPicker({ value, iconType, onChange }: IconPickerProps) {
  const [search, setSearch] = useState("");
  const [brandSearch, setBrandSearch] = useState("");
  const defaultTab = iconType === "simple" ? "brands" : iconType === "lucide" ? "icons" : "emoji";

  const filteredIcons = useMemo(() => {
    const allNames = Object.keys(icons);
    const allNameSet = new Set(allNames);
    if (!search) return CURATED_LUCIDE_ICONS.filter((n) => allNameSet.has(n));
    const q = search.toLowerCase();
    return allNames.filter((n) => n.toLowerCase().includes(q)).slice(0, 200);
  }, [search]);

  // Brand filter — when searching, flatten and filter by slug OR title substring.
  const filteredBrands = useMemo(() => {
    if (!brandSearch) return null;
    const q = brandSearch.toLowerCase();
    return SIMPLE_ICON_SLUGS.filter((s) => s.includes(q));
  }, [brandSearch]);

  return (
    <Tabs defaultValue={defaultTab} className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="emoji">Emoji</TabsTrigger>
        <TabsTrigger value="icons">Icons</TabsTrigger>
        <TabsTrigger value="brands">Brands</TabsTrigger>
      </TabsList>

      <TabsContent value="emoji">
        <ScrollArea className="h-48">
          <div className="grid grid-cols-8 gap-1 p-1">
            {CURATED_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => onChange(emoji, "emoji")}
                className={`flex h-8 w-8 items-center justify-center rounded text-lg hover:bg-accent ${
                  value === emoji && iconType === "emoji" ? "bg-accent ring-1 ring-ring" : ""
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="icons" className="space-y-2">
        <Input
          placeholder="Search icons..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-sm"
        />
        <ScrollArea className="h-48">
          <div className="grid grid-cols-8 gap-1 p-1">
            {filteredIcons.map((name) => {
              const Icon = icons[name as keyof typeof icons];
              if (!Icon) return null;
              return (
                <button
                  key={name}
                  onClick={() => onChange(name, "lucide")}
                  title={name}
                  className={`flex h-8 w-8 items-center justify-center rounded hover:bg-accent ${
                    iconType === "lucide" && value.toLowerCase() === name.toLowerCase() ? "bg-accent ring-1 ring-ring" : ""
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="brands" className="space-y-2">
        <Input
          placeholder="Search brands..."
          value={brandSearch}
          onChange={(e) => setBrandSearch(e.target.value)}
          className="h-8 text-sm"
        />
        <ScrollArea className="h-48">
          {filteredBrands ? (
            <div className="grid grid-cols-8 gap-1 p-1">
              {filteredBrands.map((slug) => {
                const isSelected = iconType === "simple" && value === slug;
                return (
                  <button
                    key={slug}
                    onClick={() => onChange(slug, "simple")}
                    title={slug}
                    className={`flex h-8 w-8 items-center justify-center rounded hover:bg-accent ${
                      isSelected ? "bg-accent ring-1 ring-ring" : ""
                    }`}
                  >
                    <SimpleIconGlyph slug={slug} size={16} />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2 p-1">
              {SIMPLE_ICON_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-8 gap-1">
                    {group.icons.map((icon) => {
                      const isSelected = iconType === "simple" && value === icon.slug;
                      return (
                        <button
                          key={icon.slug}
                          onClick={() => onChange(icon.slug, "simple")}
                          title={icon.title}
                          className={`flex h-8 w-8 items-center justify-center rounded hover:bg-accent ${
                            isSelected ? "bg-accent ring-1 ring-ring" : ""
                          }`}
                        >
                          <SimpleIconGlyph slug={icon.slug} size={16} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}
