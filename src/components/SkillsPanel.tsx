import { memo, useState, useCallback, useEffect } from "react";
import { Sparkles, Plus, Search, Download, Loader2, Check, Trash2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PanelHeader } from "@/components/PanelHeader";
import { BUILTIN_SKILLS, loadActiveSkills, saveActiveSkills } from "@/lib/skills";

interface RegistrySkill {
  id: string;
  skillId: string;
  name: string;
  installs: number;
  source: string;
}

interface InstalledSkill {
  id: string;
  filename: string;
}

function formatInstalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface SkillsPanelProps {
  projectPath: string | null;
}

export const SkillsPanel = memo(function SkillsPanel({ projectPath }: SkillsPanelProps) {
  const [query, setQuery] = useState("");
  const [registrySkills, setRegistrySkills] = useState<RegistrySkill[]>([]);
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [activeSkills, setActiveSkills] = useState<Set<string>>(new Set());

  const loadInstalled = useCallback(async () => {
    if (!projectPath) return;
    const result = await window.claude.skillsRegistry.listInstalled(projectPath);
    setInstalledSkills(result.skills);
    setInstalledIds(new Set(result.skills.map((s) => s.id)));
  }, [projectPath]);

  useEffect(() => {
    loadInstalled();
    if (projectPath) {
      setActiveSkills(new Set(loadActiveSkills(projectPath)));
    }
  }, [projectPath, loadInstalled]);

  const doSearch = useCallback(async (searchQuery?: string) => {
    setLoading(true);
    try {
      const result = await window.claude.skillsRegistry.search(searchQuery || undefined, 50);
      if (result.ok) setRegistrySkills(result.skills);
    } catch {}
    setLoading(false);
  }, []);

  const handleInstall = useCallback(async (skill: RegistrySkill) => {
    if (!projectPath) return;
    setInstallingId(skill.id);
    try {
      await window.claude.skillsRegistry.install(projectPath, skill.source, skill.skillId);
      setInstalledIds((prev) => new Set(prev).add(skill.skillId));
      loadInstalled();
    } catch {}
    setInstallingId(null);
  }, [projectPath, loadInstalled]);

  const toggleSkill = useCallback((skillId: string) => {
    if (!projectPath) return;
    setActiveSkills((prev) => {
      const next = new Set(prev);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      saveActiveSkills(projectPath, [...next]);
      return next;
    });
  }, [projectPath]);

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Skills" icon={Sparkles} />

      <Tabs defaultValue="installed" className="flex min-h-0 flex-1 flex-col">
        <div className="px-2">
          <TabsList variant="line" className="w-full">
            <TabsTrigger value="installed" className="flex-1 text-xs">Installed</TabsTrigger>
            <TabsTrigger value="browse" className="flex-1 text-xs">Browse</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="installed" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="space-y-0.5 p-2">
              {installedSkills.length === 0 && (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  No skills installed yet
                </div>
              )}
              {installedSkills.map((skill) => (
                <button
                  key={skill.id}
                  onClick={() => toggleSkill(skill.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-xs transition-colors hover:bg-muted/50"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                  <span className="min-w-0 flex-1 truncate text-foreground">{skill.id}</span>
                  {activeSkills.has(skill.id) && (
                    <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                  )}
                </button>
              ))}

              {BUILTIN_SKILLS.length > 0 && (
                <>
                  <div className="px-2 pt-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/50">
                    Builtin
                  </div>
                  {BUILTIN_SKILLS.map((skill) => {
                    const Icon = skill.icon;
                    return (
                      <button
                        key={skill.id}
                        onClick={() => toggleSkill(skill.id)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-xs transition-colors hover:bg-muted/50"
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                        <span className="min-w-0 flex-1 truncate text-foreground">{skill.name}</span>
                        {activeSkills.has(skill.id) && (
                          <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                        )}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="browse" className="min-h-0 flex-1">
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") doSearch(query); }}
                  placeholder="Search skills..."
                  spellCheck={false}
                  className="h-7 w-full rounded-md border border-foreground/10 bg-background pe-2 ps-7 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/20"
                />
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => doSearch(query)} disabled={loading}>
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
              </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-0.5 p-2">
                {registrySkills.map((skill) => {
                  const isInstalling = installingId === skill.id;
                  const isInstalled = installedIds.has(skill.skillId);
                  return (
                    <div key={skill.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/30">
                      <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-foreground">{skill.name}</div>
                        <div className="truncate text-[10px] text-muted-foreground/50">{skill.source} · {formatInstalls(skill.installs)}</div>
                      </div>
                      <button
                        onClick={() => handleInstall(skill)}
                        disabled={!projectPath || isInstalling || isInstalled}
                        className={`shrink-0 rounded p-1 transition-colors ${isInstalled ? "text-emerald-500" : "text-muted-foreground/50 hover:text-foreground"}`}
                      >
                        {isInstalling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isInstalled ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
});
