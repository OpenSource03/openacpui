import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { app } from "electron";
import type { InstalledAgent, BinaryCheckResult } from "@shared/types/registry";
import type { ACPConfigOption } from "@shared/types/acp";

// Re-export shared types so existing consumers importing from this file still work
export type { InstalledAgent, BinaryCheckResult } from "@shared/types/registry";
export type { EngineId } from "@shared/types/engine";

const execFileAsync = promisify(execFile);

const BUILTIN_CLAUDE: InstalledAgent = {
  id: "claude-code",
  name: "Claude Code",
  engine: "claude",
  builtIn: true,
  icon: "brain",
};

const BUILTIN_CODEX: InstalledAgent = {
  id: "codex",
  name: "Codex",
  engine: "codex",
  builtIn: true,
  icon: "zap",
};

const BUILTIN_IDS = new Set([BUILTIN_CLAUDE.id, BUILTIN_CODEX.id]);

const agents = new Map<string, InstalledAgent>();
agents.set(BUILTIN_CLAUDE.id, BUILTIN_CLAUDE);
agents.set(BUILTIN_CODEX.id, BUILTIN_CODEX);

function getConfigPath(): string {
  return path.join(app.getPath("userData"), "openacpui-data", "agents.json");
}

export function loadUserAgents(): void {
  try {
    const data = JSON.parse(fs.readFileSync(getConfigPath(), "utf-8"));
    for (const agent of data) {
      if (!BUILTIN_IDS.has(agent.id)) agents.set(agent.id, agent);
    }
  } catch {
    /* no config yet */
  }
}

export function getAgent(id: string): InstalledAgent | undefined {
  return agents.get(id);
}

export function listAgents(): InstalledAgent[] {
  return Array.from(agents.values());
}

export function saveAgent(agent: InstalledAgent): void {
  if (BUILTIN_IDS.has(agent.id)) return; // Protect built-in agents
  if (!agent.id?.trim() || !agent.name?.trim()) throw new Error("Agent must have id and name");
  if (agent.engine === "acp" && !agent.binary?.trim()) throw new Error("ACP agents require a binary");
  agents.set(agent.id, agent);
  persistUserAgents();
}

export function deleteAgent(id: string): void {
  if (BUILTIN_IDS.has(id)) return;
  agents.delete(id);
  persistUserAgents();
}

/** Update only the cached config options for an agent (fire-and-forget from renderer) */
export function updateCachedConfig(id: string, configOptions: ACPConfigOption[]): void {
  const agent = agents.get(id);
  if (!agent || agent.builtIn) return;
  agent.cachedConfigOptions = configOptions;
  persistUserAgents();
}

function persistUserAgents(): void {
  const userAgents = listAgents().filter((a) => !a.builtIn);
  const dir = path.dirname(getConfigPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(userAgents, null, 2));
}

// ── Binary detection helpers ──

/** Map process.platform + process.arch to preferred registry platform keys (in order). */
export function getRegistryPlatformKeys(): string[] {
  const archMap: Record<string, string> = { arm64: "aarch64", x64: "x86_64" };
  const platformMap: Record<string, string> = { darwin: "darwin", linux: "linux", win32: "windows" };
  const platform = platformMap[process.platform];
  const arch = archMap[process.arch];
  if (!platform || !arch) return [];

  const primary = `${platform}-${arch}`;
  // Windows on ARM commonly runs x86_64 binaries under emulation.
  if (process.platform === "win32" && process.arch === "arm64") {
    return [primary, "windows-x86_64"];
  }
  return [primary];
}

/** Resolve a command name to its absolute path via `which` (or `where` on Windows). */
async function resolveWhich(cmd: string): Promise<string | null> {
  if (!cmd.trim()) return null;
  try {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    const { stdout } = await execFileAsync(whichCmd, [cmd]);
    // `where` on Windows may return multiple CRLF lines; take the first non-empty.
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? null;
  } catch {
    return null; // command not found
  }
}

function quotePosixArg(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

/**
 * Windows fallback for binaries installed in a bash-managed PATH (e.g. Git Bash).
 * Returns a runnable command via `bash -lc <cmd ...>` when detection succeeds.
 */
async function resolveViaBash(
  cmd: string,
  targetArgs?: string[],
): Promise<BinaryCheckResult | null> {
  if (process.platform !== "win32" || !cmd.trim()) return null;

  const loginCommand = [cmd, ...(targetArgs ?? [])].map(quotePosixArg).join(" ");
  for (const shell of ["bash", "sh"]) {
    try {
      const { stdout } = await execFileAsync(shell, ["-lc", `command -v ${quotePosixArg(cmd)}`]);
      const found = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      if (found) {
        return { path: shell, args: ["-lc", loginCommand] };
      }
    } catch {
      // Try next shell candidate.
    }
  }

  return null;
}

/**
 * Convert registry cmd (which may include relative paths/quotes/extensions) to
 * a bare executable name for PATH lookup.
 */
function extractBinaryName(cmd: string): string {
  const trimmed = cmd.trim();
  if (!trimmed) return "";

  const match = trimmed.match(/^"([^"]+)"|^'([^']+)'|^(\S+)/);
  const executable = (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
  const normalized = executable.replace(/\\/g, "/");
  const base = path.posix.basename(normalized);
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, "");
}

/**
 * Batch-check which binary-only agents have their command available on the system PATH.
 * Receives raw binary distribution maps from registry agents, resolves the current platform,
 * and runs `which`/`where` for each matching command.
 */
export async function checkBinaries(
  agents: Array<{ id: string; binary: Record<string, { cmd: string; args?: string[] }> }>,
): Promise<Record<string, BinaryCheckResult | null>> {
  const keys = getRegistryPlatformKeys();
  if (keys.length === 0) return {};

  const results: Record<string, BinaryCheckResult | null> = {};
  await Promise.all(
    agents.map(async ({ id, binary }) => {
      const target = keys.map((k) => binary[k]).find((candidate) => candidate != null);
      if (!target) {
        results[id] = null;
        return;
      }
      const cmdName = extractBinaryName(target.cmd);
      const resolved = await resolveWhich(cmdName);
      if (resolved) {
        results[id] = { path: resolved, args: target.args };
        return;
      }
      results[id] = await resolveViaBash(cmdName, target.args);
    }),
  );
  return results;
}
