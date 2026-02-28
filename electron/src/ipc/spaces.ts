import { ipcMain } from "electron";
import path from "path";
import fs from "fs";
import { getDataDir } from "../lib/data-dir";
import { log } from "../lib/logger";

interface Space {
  id: string;
  name: string;
  icon: string;
  iconType: string;
  color: { hue: number; chroma: number; gradientHue?: number; opacity?: number };
  createdAt: number;
  order: number;
}

const DEFAULT_SPACE: Space = {
  id: "default",
  name: "General",
  icon: "Layers",
  iconType: "lucide",
  color: { hue: 0, chroma: 0 },
  createdAt: Date.now(),
  order: 0,
};

function getSpacesFilePath(): string {
  return path.join(getDataDir(), "spaces.json");
}

function readSpaces(): Space[] | null {
  const filePath = getSpacesFilePath();
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function writeSpaces(spaces: Space[]): void {
  fs.writeFileSync(getSpacesFilePath(), JSON.stringify(spaces, null, 2), "utf-8");
}

export function register(): void {
  ipcMain.handle("spaces:list", () => {
    try {
      let spaces = readSpaces();
      if (!spaces) {
        spaces = [DEFAULT_SPACE];
        writeSpaces(spaces);
      }
      return spaces;
    } catch (err) {
      log("SPACES:LIST_ERR", (err as Error).message);
      return [DEFAULT_SPACE];
    }
  });

  ipcMain.handle("spaces:save", (_event, spaces: Space[]) => {
    try {
      writeSpaces(spaces);
      return { ok: true };
    } catch (err) {
      log("SPACES:SAVE_ERR", (err as Error).message);
      return { error: (err as Error).message };
    }
  });
}
