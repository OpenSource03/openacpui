import fs from "fs";
import path from "path";
import { app } from "electron";

export interface AgentDefinition {
  id: string;
  name: string;
  engine: "claude" | "acp";
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
}

const BUILTIN_CLAUDE: AgentDefinition = {
  id: "claude-code",
  name: "Claude Code",
  engine: "claude",
  builtIn: true,
  icon: "brain",
};

const agents = new Map<string, AgentDefinition>();
agents.set(BUILTIN_CLAUDE.id, BUILTIN_CLAUDE);

function getConfigPath(): string {
  return path.join(app.getPath("userData"), "openacpui-data", "agents.json");
}

export function loadUserAgents(): void {
  try {
    const data = JSON.parse(fs.readFileSync(getConfigPath(), "utf-8"));
    for (const agent of data) {
      if (agent.id !== "claude-code") agents.set(agent.id, agent);
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
  if (agent.id === "claude-code") return; // Protect built-in
  if (!agent.id?.trim() || !agent.name?.trim()) throw new Error("Agent must have id and name");
  if (agent.engine === "acp" && !agent.binary?.trim()) throw new Error("ACP agents require a binary");
  agents.set(agent.id, agent);
  persistUserAgents();
}

export function deleteAgent(id: string): void {
  if (id === "claude-code") return;
  agents.delete(id);
  persistUserAgents();
}

function persistUserAgents(): void {
  const userAgents = listAgents().filter((a) => !a.builtIn);
  const dir = path.dirname(getConfigPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(userAgents, null, 2));
}
