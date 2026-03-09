import { BrowserWindow, dialog, ipcMain } from "electron";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { getDataDir } from "../lib/data-dir";
import { log } from "../lib/logger";
import { captureEvent } from "../lib/posthog";

interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  spaceId?: string;
}

function getProjectsFilePath(): string {
  return path.join(getDataDir(), "projects.json");
}

function readProjects(): Project[] {
  const filePath = getProjectsFilePath();
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return [];
  }
}

function writeProjects(projects: Project[]): void {
  fs.writeFileSync(getProjectsFilePath(), JSON.stringify(projects, null, 2), "utf-8");
}

export function register(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("projects:list", () => {
    try {
      return readProjects();
    } catch (err) {
      log("PROJECTS:LIST_ERR", (err as Error).message);
      return [];
    }
  });

  ipcMain.handle("projects:create", async (_event, spaceId?: string) => {
    try {
      const mainWindow = getMainWindow();
      if (!mainWindow) return null;
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) return null;

      const folderPath = result.filePaths[0];
      const projects = readProjects();

      const existing = projects.find((p) => p.path === folderPath);
      if (existing) return existing;

      const project: Project = {
        id: crypto.randomUUID(),
        name: path.basename(folderPath),
        path: folderPath,
        createdAt: Date.now(),
        // Assign to the caller's active space (falls back to "default" if omitted)
        ...(spaceId && spaceId !== "default" ? { spaceId } : {}),
      };
      projects.push(project);
      writeProjects(projects);
      void captureEvent("project_created");
      return project;
    } catch (err) {
      log("PROJECTS:CREATE_ERR", (err as Error).message);
      return null;
    }
  });

  ipcMain.handle("projects:create-dev", (_event, name: string, spaceId?: string) => {
    try {
      const projectName = String(name || "").trim() || "Example Project";
      const slug = projectName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "example-project";
      const rootDir = path.join(getDataDir(), "dev-projects");
      const folderPath = path.join(rootDir, slug);
      fs.mkdirSync(folderPath, { recursive: true });

      const readmePath = path.join(folderPath, "README.md");
      if (!fs.existsSync(readmePath)) {
        fs.writeFileSync(
          readmePath,
          `# ${projectName}\n\nDevelopment-only sample project used for seeded demo chats.\n`,
          "utf-8",
        );
      }

      const projects = readProjects();
      const existing = projects.find((p) => p.path === folderPath);
      if (existing) return existing;

      const project: Project = {
        id: crypto.randomUUID(),
        name: projectName,
        path: folderPath,
        createdAt: Date.now(),
        ...(spaceId && spaceId !== "default" ? { spaceId } : {}),
      };
      projects.push(project);
      writeProjects(projects);
      return project;
    } catch (err) {
      log("PROJECTS:CREATE_DEV_ERR", (err as Error).message);
      return null;
    }
  });

  ipcMain.handle("projects:delete", (_event, projectId: string) => {
    try {
      const projects = readProjects().filter((p) => p.id !== projectId);
      writeProjects(projects);
      const sessionsDir = path.join(getDataDir(), "sessions", projectId);
      if (fs.existsSync(sessionsDir)) {
        fs.rmSync(sessionsDir, { recursive: true, force: true });
      }
      return { ok: true };
    } catch (err) {
      log("PROJECTS:DELETE_ERR", (err as Error).message);
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle("projects:rename", (_event, projectId: string, name: string) => {
    try {
      const projects = readProjects().map((p) =>
        p.id === projectId ? { ...p, name } : p,
      );
      writeProjects(projects);
      return { ok: true };
    } catch (err) {
      log("PROJECTS:RENAME_ERR", (err as Error).message);
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle("projects:reorder", (_event, projectId: string, targetProjectId: string) => {
    try {
      const projects = readProjects();
      const fromIdx = projects.findIndex((p) => p.id === projectId);
      const toIdx = projects.findIndex((p) => p.id === targetProjectId);
      if (fromIdx === -1 || toIdx === -1) return { error: "Project not found" };
      const [moved] = projects.splice(fromIdx, 1);
      projects.splice(toIdx, 0, moved);
      writeProjects(projects);
      return { ok: true };
    } catch (err) {
      log("PROJECTS:REORDER_ERR", (err as Error).message);
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle("projects:update-space", (_event, projectId: string, spaceId: string) => {
    try {
      const projects = readProjects().map((p) =>
        p.id === projectId ? { ...p, spaceId } : p,
      );
      writeProjects(projects);
      return { ok: true };
    } catch (err) {
      log("PROJECTS:UPDATE_SPACE_ERR", (err as Error).message);
      return { error: (err as Error).message };
    }
  });
}
