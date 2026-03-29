import { ipcMain } from "electron";
import path from "path";
import fs from "fs";
import { log } from "../lib/logger";

const SKILLS_API = "https://skills.sh/api/search";

function saveSkill(cwd: string, skillId: string, content: string): { ok: boolean; path?: string; error?: string } {
  const skillsDir = path.join(cwd, ".harnss", "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  const filePath = path.join(skillsDir, `${skillId}.md`);
  fs.writeFileSync(filePath, content, "utf-8");
  log("SKILLS", `installed ${skillId} (${content.length} chars) → ${filePath}`);
  return { ok: true, path: filePath };
}

export function register(): void {
  ipcMain.handle("skills-registry:install", async (_event, { cwd, source, skillId }: { cwd: string; source: string; skillId: string }) => {
    try {
      const rawUrl = `https://raw.githubusercontent.com/${source}/main/skills/${skillId}/SKILL.md`;
      log("SKILLS", `downloading ${rawUrl}`);
      const response = await fetch(rawUrl, { signal: AbortSignal.timeout(15000) });

      if (!response.ok) {
        const altUrl = `https://raw.githubusercontent.com/${source}/main/${skillId}/SKILL.md`;
        const alt = await fetch(altUrl, { signal: AbortSignal.timeout(10000) });
        if (!alt.ok) {
          const alt2 = `https://raw.githubusercontent.com/${source}/main/${skillId}.md`;
          const alt2r = await fetch(alt2, { signal: AbortSignal.timeout(10000) });
          if (!alt2r.ok) return { ok: false, error: `Skill not found at ${source}` };
          const content = await alt2r.text();
          return saveSkill(cwd, skillId, content);
        }
        const content = await alt.text();
        return saveSkill(cwd, skillId, content);
      }

      const content = await response.text();
      return saveSkill(cwd, skillId, content);
    } catch (err) {
      log("SKILLS", `install failed: ${(err as Error).message}`);
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("skills-registry:list-installed", async (_event, cwd: string) => {
    try {
      const skillsDir = path.join(cwd, ".harnss", "skills");
      if (!fs.existsSync(skillsDir)) return { skills: [] };
      const files = fs.readdirSync(skillsDir).filter((f) => f.endsWith(".md"));
      return { skills: files.map((f) => ({ id: f.replace(/\.md$/, ""), filename: f })) };
    } catch {
      return { skills: [] };
    }
  });

  ipcMain.handle("skills-registry:load-contents", async (_event, { cwd, skillIds }: { cwd: string; skillIds: string[] }) => {
    const contents: Array<{ id: string; content: string }> = [];
    const skillsDir = path.join(cwd, ".harnss", "skills");
    for (const id of skillIds) {
      const filePath = path.join(skillsDir, `${id}.md`);
      try {
        if (fs.existsSync(filePath)) {
          contents.push({ id, content: fs.readFileSync(filePath, "utf-8") });
        }
      } catch {}
    }
    return { contents };
  });

  ipcMain.handle("skills-registry:search", async (_event, query?: string, limit = 50) => {
    try {
      const url = new URL(SKILLS_API);
      if (query) url.searchParams.set("q", query);
      url.searchParams.set("limit", String(limit));

      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10000),
        headers: { Accept: "application/json" },
      });

      if (!response.ok) return { ok: false, skills: [], error: `HTTP ${response.status}` };

      const data = (await response.json()) as {
        query: string;
        searchType: string;
        skills: Array<{ id: string; skillId: string; name: string; installs: number; source: string }>;
        count: number;
      };

      return {
        ok: true,
        skills: data.skills,
        count: data.count,
        query: data.query,
      };
    } catch (err) {
      log("SKILLS_REGISTRY", `search failed: ${(err as Error).message}`);
      return { ok: false, skills: [], error: (err as Error).message };
    }
  });
}
