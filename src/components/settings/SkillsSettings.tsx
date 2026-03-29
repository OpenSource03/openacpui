import { memo, useState, useCallback, useEffect } from "react";
import { Sparkles, Store, Code, Search, Plus, Loader2, Check, RefreshCw, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BUILTIN_SKILLS } from "@/lib/skills";

interface RegistrySkill {
  id: string;
  skillId: string;
  name: string;
  installs: number;
  source: string;
}

function formatInstalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface SkillsSettingsProps {
  projectPath?: string | null;
}

export const SkillsSettings = memo(function SkillsSettings({ projectPath }: SkillsSettingsProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [skills, setSkills] = useState<RegistrySkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());

  const doSearch = useCallback(async (query?: string) => {
    setLoading(true);
    try {
      const result = await window.claude.skillsRegistry.search(query || undefined, 100);
      if (result.ok) setSkills(result.skills);
    } catch {}
    setLoading(false);
    setSearched(true);
  }, []);

  useEffect(() => { doSearch(); }, [doSearch]);

  const filteredBuiltin = searchQuery
    ? BUILTIN_SKILLS.filter((s) =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : BUILTIN_SKILLS;

  return (
    <div className="flex h-full flex-col">
      <Tabs defaultValue="store" className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-foreground/[0.06] px-6">
          <div className="py-4">
            <h2 className="text-base font-semibold text-foreground">Skills</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Specialized capabilities that enhance your AI coding assistant
            </p>
          </div>
          <TabsList variant="line">
            <TabsTrigger value="store" className="gap-1.5">
              <Store className="h-3.5 w-3.5" />
              Skill Store
            </TabsTrigger>
            <TabsTrigger value="my-skills" className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              My Skills
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="store" className="min-h-0 flex-1">
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-5 py-3">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") doSearch(searchQuery); }}
                  placeholder="Search skills..."
                  spellCheck={false}
                  className="h-8 w-full rounded-md border border-foreground/10 bg-background pe-3 ps-8 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20"
                />
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => doSearch(searchQuery)} disabled={loading}>
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="grid grid-cols-2 gap-3 px-5 pb-5">
                {skills.map((skill) => (
                  <div key={skill.id} className="flex flex-col rounded-lg border border-foreground/[0.06] bg-background transition-colors hover:border-foreground/10">
                    <div className="flex flex-1 flex-col gap-2 p-3">
                      <div className="flex items-start gap-2.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.04]">
                          <Sparkles className="h-4 w-4 text-muted-foreground/50" />
                        </div>
                        <div className="min-w-0">
                          <span className="truncate text-sm font-semibold text-foreground">{skill.name}</span>
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
                            <span>{skill.source}</span>
                            <span>·</span>
                            <span>{formatInstalls(skill.installs)} installs</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-foreground/[0.04] px-3 py-2">
                      <a
                        href={`https://github.com/${skill.source}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground"
                      >
                        {skill.source}
                      </a>
                      {(() => {
                        const isInstalling = installingId === skill.id;
                        const isInstalled = installedIds.has(skill.id);
                        return (
                          <Button
                            variant={isInstalled ? "ghost" : "outline"}
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            disabled={!projectPath || isInstalling || isInstalled}
                            onClick={async () => {
                              if (!projectPath) return;
                              setInstallingId(skill.id);
                              try {
                                await window.claude.skillsRegistry.install(projectPath, skill.source, skill.skillId);
                                setInstalledIds((prev) => new Set(prev).add(skill.id));
                              } catch {}
                              setInstallingId(null);
                            }}
                          >
                            {isInstalling ? <Loader2 className="h-3 w-3 animate-spin" /> : isInstalled ? <Check className="h-3 w-3 text-emerald-500" /> : <Plus className="h-3 w-3" />}
                            {isInstalling ? "Adding..." : isInstalled ? "Added" : "Add"}
                          </Button>
                        );
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </TabsContent>

        <TabsContent value="my-skills" className="min-h-0 flex-1">
          <div className="flex h-full flex-col">
            <ScrollArea className="min-h-0 flex-1">
              <div className="px-5 py-4">
                <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Builtin Skills
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {filteredBuiltin.map((skill) => {
                    const Icon = skill.icon;
                    return (
                      <div key={skill.id} className="flex flex-col rounded-lg border border-foreground/[0.06] bg-background">
                        <div className="flex flex-1 flex-col gap-2 p-3">
                          <div className="flex items-start gap-2.5">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.04]">
                              <Icon className="h-4 w-4 text-muted-foreground/70" />
                            </div>
                            <div className="min-w-0">
                              <span className="text-sm font-semibold text-foreground">{skill.name}</span>
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {skill.tags.map((tag) => (
                                  <span key={tag} className="rounded-full bg-foreground/[0.05] px-1.5 py-px text-[10px] text-muted-foreground/60">{tag}</span>
                                ))}
                              </div>
                            </div>
                          </div>
                          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{skill.description}</p>
                        </div>
                        <div className="flex items-center justify-end border-t border-foreground/[0.04] px-3 py-2">
                          <span className="rounded-full bg-foreground/[0.06] px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground/60">Coming Soon</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 flex flex-col items-center gap-2 rounded-lg border border-dashed border-foreground/[0.08] p-6 text-center">
                  <Code className="h-6 w-6 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">
                    Add custom skills via <code className="rounded bg-foreground/[0.06] px-1 py-0.5 text-xs">.harnss/skills/*.md</code>
                  </p>
                </div>
              </div>
            </ScrollArea>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
});
