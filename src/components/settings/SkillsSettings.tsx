import { memo, useState } from "react";
import { Sparkles, Store, Code, Search } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BUILTIN_SKILLS } from "@/lib/skills";

export const SkillsSettings = memo(function SkillsSettings() {
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = searchQuery
    ? BUILTIN_SKILLS.filter((s) =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.tags.some((t) => t.includes(searchQuery.toLowerCase()))
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
                  placeholder="Search skills..."
                  spellCheck={false}
                  className="h-8 w-full rounded-md border border-foreground/10 bg-background pe-3 ps-8 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20"
                />
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="grid grid-cols-2 gap-3 px-5 pb-5">
                {filtered.map((skill) => {
                  const Icon = skill.icon;
                  return (
                    <div key={skill.id} className="flex flex-col rounded-lg border border-foreground/[0.06] bg-background transition-colors hover:border-foreground/10">
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
                        <span className="rounded-full bg-foreground/[0.06] px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground/60">
                          Coming Soon
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </TabsContent>

        <TabsContent value="my-skills" className="min-h-0 flex-1">
          <div className="flex flex-1 flex-col items-center justify-center px-4">
            <div className="flex max-w-md flex-col items-center gap-3 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/50 bg-muted/30">
                <Code className="h-7 w-7 text-foreground/80" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">Custom Skills</h3>
              <p className="text-sm text-muted-foreground">
                Create custom skills by adding <code className="rounded bg-foreground/[0.06] px-1 py-0.5 text-xs">.md</code> files
                to your project's <code className="rounded bg-foreground/[0.06] px-1 py-0.5 text-xs">.harnss/skills/</code> directory.
              </p>
              <p className="text-xs text-muted-foreground/60">
                Skills inject specialized instructions into the AI context when activated.
              </p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
});
