import fs from "fs";
import path from "path";
import { app } from "electron";

export type EngineId = "claude" | "acp" | "codex";

export interface AgentDefinition {
  id: string;
  name: string;
  engine: EngineId;
  binary?: string;
  args?: string[];
  env?: Record<string, string>;
  icon?: string;
  builtIn?: boolean;
  /** Matching id from the ACP registry (for update detection) */
  registryId?: string;
  /** Version from the registry at install time */
  registryVersion?: string;
  /** Description from the registry, shown in agent cards */
  description?: string;
  /** Cached config options from the last ACP session — shown before session starts */
  cachedConfigOptions?: unknown[];
}

const BUILTIN_CLAUDE: AgentDefinition = {
  id: "claude-code",
  name: "Claude Code",
  engine: "claude",
  builtIn: true,
  icon: "brain",
};

const BUILTIN_CODEX: AgentDefinition = {
  id: "codex",
  name: "Codex",
  engine: "codex",
  builtIn: true,
  icon: "zap",
};

const BUILTIN_IDS = new Set([BUILTIN_CLAUDE.id, BUILTIN_CODEX.id]);

const agents = new Map<string, AgentDefinition>();
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

export function getAgent(id: string): AgentDefinition | undefined {
  return agents.get(id);
}

export function listAgents(): AgentDefinition[] {
  return Array.from(agents.values());
}

export function saveAgent(agent: AgentDefinition): void {
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
export function updateCachedConfig(id: string, configOptions: unknown[]): void {
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
