import { ipcMain, type BrowserWindow } from "electron";
import crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { log } from "../lib/logger";
import { reportError } from "../lib/error-utils";
import { getDataDir, getSessionFilePath } from "../lib/data-dir";
import { getSDK, clientAppEnv } from "../lib/sdk";
import type { QueryHandle } from "../lib/sdk";
import { getClaudeBinaryPath } from "../lib/claude-binary";
import { AsyncChannel } from "../lib/async-channel";
import { safeSend } from "../lib/safe-send";
import { sessions as claudeSessions } from "./claude-sessions";
import type { PermissionResult } from "./claude-sessions";
import { openclawGroupQuery } from "./openclaw-sessions";
import type {
  AgentGroup,
  AgentSlot,
  GroupMessage,
  GroupSession,
  GroupSessionEvent,
} from "../../../shared/types/groups";

interface UIMessage {
  id: string;
  role: "user" | "assistant" | "tool_call" | "tool_result" | "system" | "summary";
  content: string;
  timestamp: number;
  groupSlot?: { label: string; color: string; engine: string; model: string };
}

interface PersistedGroupSession {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  totalCost: number;
  engine: "group";
  groupId: string;
  messages: UIMessage[];
  lastMessageAt: number;
  slotSdkSessionIds?: Record<string, string>;
}

const GROUPS_DIR = "groups";
const GROUP_SESSIONS_DIR = "group-sessions";

function getGroupsDir(): string {
  const dir = path.join(getDataDir(), GROUPS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getGroupSessionsDir(): string {
  const dir = path.join(getDataDir(), GROUP_SESSIONS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

interface GroupSessionState {
  session: GroupSession;
  aborted: boolean;
  projectId?: string;
  groupName?: string;
  slotSessionIds: Set<string>;
}

const activeGroupSessions = new Map<string, GroupSessionState>();

function groupMessageToUIMessage(msg: GroupMessage, slot: AgentSlot | undefined): UIMessage {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    timestamp: typeof msg.timestamp === "string" ? new Date(msg.timestamp).getTime() : msg.timestamp as unknown as number,
    groupSlot: slot && msg.role === "assistant"
      ? { label: slot.label, color: slot.color, engine: slot.engine, model: slot.model }
      : undefined,
  };
}

function convertGroupMessagesToUI(messages: GroupMessage[], slots: AgentSlot[]): UIMessage[] {
  const slotMap = new Map(slots.map((s) => [s.id, s]));
  return messages.map((m) => groupMessageToUIMessage(m, slotMap.get(m.slotId)));
}

function saveGroupSessionAsPersistedSession(
  session: GroupSession,
  projectId: string,
  groupName: string,
  slots: AgentSlot[],
): void {
  const now = Date.now();
  const title = groupName
    ? `${groupName}: ${session.prompt.length > 50 ? session.prompt.slice(0, 47) + "..." : session.prompt}`
    : session.prompt.length > 60 ? session.prompt.slice(0, 57) + "..." : session.prompt;

  const uiMessages = convertGroupMessagesToUI(session.messages, slots);
  const lastMessageAt = uiMessages.length > 0 ? uiMessages[uiMessages.length - 1].timestamp : now;

  const persisted: PersistedGroupSession = {
    id: session.id,
    projectId,
    title,
    createdAt: typeof session.startedAt === "string" ? new Date(session.startedAt).getTime() : now,
    totalCost: 0,
    engine: "group",
    groupId: session.groupId,
    messages: uiMessages,
    lastMessageAt,
    slotSdkSessionIds: session.slotSdkSessionIds,
  };

  const filePath = getSessionFilePath(projectId, session.id);
  fs.writeFileSync(filePath, JSON.stringify(persisted), "utf-8");

  const meta = {
    id: session.id,
    projectId,
    title,
    createdAt: persisted.createdAt,
    lastMessageAt,
    engine: "group" as const,
    groupId: session.groupId,
  };
  const metaPath = filePath.replace(/\.json$/, ".meta.json");
  fs.writeFileSync(metaPath, JSON.stringify(meta), "utf-8");
}

function emit(getMainWindow: () => BrowserWindow | null, event: GroupSessionEvent): void {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send("group:event", event);
  }
}

function createMessageId(): string {
  return `gm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function startClaudeSlotSession(
  slot: AgentSlot,
  prompt: string,
  cwd: string,
  groupSessionId: string,
  getMainWindow: () => BrowserWindow | null,
): Promise<string> {
  const sessionId = `${groupSessionId}-slot-${slot.id}`;
  const logPrefix = `group=${groupSessionId.slice(0, 8)} slot=${slot.id}`;
  log("GROUP_SLOT_START", `${logPrefix} engine=claude model=${slot.model}`);

  const query = await getSDK();
  const cliPath = await getClaudeBinaryPath();
  const channel = new AsyncChannel<unknown>();
  const pendingPermissions = new Map<string, { resolve: (result: PermissionResult) => void }>();

  const sessionEntry: {
    channel: AsyncChannel<unknown>;
    queryHandle: QueryHandle | null;
    eventCounter: number;
    pendingPermissions: Map<string, { resolve: (result: PermissionResult) => void }>;
    stopping?: boolean;
    stopReason?: string;
  } = {
    channel,
    queryHandle: null,
    eventCounter: 0,
    pendingPermissions,
  };
  claudeSessions.set(sessionId, sessionEntry);

  const groupState = activeGroupSessions.get(groupSessionId);
  groupState?.slotSessionIds.add(sessionId);

  const previousSdkSessionId = groupState?.session.slotSdkSessionIds?.[slot.id];

  const canUseTool = (
    toolName: string,
    input: unknown,
    context: { toolUseID: string; suggestions: unknown; decisionReason: string },
  ) =>
    new Promise<PermissionResult>((resolve) => {
      const requestId = crypto.randomUUID();
      pendingPermissions.set(requestId, { resolve });
      safeSend(getMainWindow, "claude:permission_request", {
        _sessionId: sessionId,
        _groupSessionId: groupSessionId,
        _slotId: slot.id,
        requestId,
        toolName,
        toolInput: input,
        toolUseId: context.toolUseID,
        suggestions: context.suggestions,
        decisionReason: context.decisionReason,
      });
    });

  const queryOptions: Record<string, unknown> = {
    cwd,
    model: slot.model,
    maxTurns: 10,
    thinking: { type: "adaptive" },
    canUseTool,
    settingSources: ["user", "project", "local"],
    pathToClaudeCodeExecutable: cliPath,
    env: { ...process.env, ...clientAppEnv() },
    stderr: (data: string) => {
      const trimmed = data.trim();
      if (trimmed) {
        log("GROUP_SLOT_STDERR", `${logPrefix} ${trimmed}`);
        safeSend(getMainWindow, "claude:stderr", {
          data,
          _sessionId: sessionId,
          _groupSessionId: groupSessionId,
          _slotId: slot.id,
        });
      }
    },
  };

  if (previousSdkSessionId) {
    queryOptions.resume = previousSdkSessionId;
    log("GROUP_SLOT_RESUME", `${logPrefix} sdkSessionId=${previousSdkSessionId}`);
  }

  let q: QueryHandle;
  try {
    q = query({ prompt: channel, options: queryOptions });
    sessionEntry.queryHandle = q;
  } catch (err) {
    claudeSessions.delete(sessionId);
    groupState?.slotSessionIds.delete(sessionId);
    throw err;
  }

  channel.push({
    type: "user",
    message: { role: "user", content: prompt },
    parent_tool_use_id: null,
    session_id: sessionId,
  });
  channel.close();

  const SLOT_TIMEOUT_MS = 5 * 60 * 1000;
  let text = "";
  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Slot query timed out after 5 minutes")), SLOT_TIMEOUT_MS),
    );
    const iterateSlot = async () => {
      for await (const message of q) {
        sessionEntry.eventCounter++;
        const msgObj = message as Record<string, unknown>;
        msgObj._sessionId = sessionId;
        msgObj._groupSessionId = groupSessionId;
        msgObj._slotId = slot.id;

        safeSend(getMainWindow, "claude:event", message);

        if (msgObj.type === "system" && msgObj.subtype === "init" && typeof msgObj.session_id === "string") {
          if (groupState?.session) {
            if (!groupState.session.slotSdkSessionIds) groupState.session.slotSdkSessionIds = {};
            groupState.session.slotSdkSessionIds[slot.id] = msgObj.session_id;
            log("GROUP_SLOT_SDK_SESSION", `${logPrefix} sdkSessionId=${msgObj.session_id}`);
          }
        }

        if (msgObj.type === "assistant") {
          const content = (msgObj.message as Record<string, unknown>)?.content;
          if (Array.isArray(content)) {
            for (const block of content as Array<Record<string, unknown>>) {
              if (block.type === "text") text += block.text as string;
            }
          }
        }
        if (msgObj.type === "result") {
          const result = msgObj.result;
          if (typeof result === "string" && result) text = result;
        }
      }
    };
    await Promise.race([iterateSlot(), timeoutPromise]);
  } catch (err) {
    reportError("GROUP_SLOT_QUERY_ERR", err, { sessionId, groupSessionId, slotId: slot.id });
    try { q.close(); } catch {}
  } finally {
    claudeSessions.delete(sessionId);
    groupState?.slotSessionIds.delete(sessionId);
    safeSend(getMainWindow, "claude:exit", {
      code: 0,
      _sessionId: sessionId,
      _groupSessionId: groupSessionId,
      _slotId: slot.id,
    });
  }

  log("GROUP_SLOT_DONE", `${logPrefix} events=${sessionEntry.eventCounter} text_len=${text.length}`);
  return text || "(no response)";
}

async function startOpenClawSlotSession(
  slot: AgentSlot,
  prompt: string,
  groupSessionId: string,
  getMainWindow: () => BrowserWindow | null,
): Promise<string> {
  const sessionId = `${groupSessionId}-slot-${slot.id}`;
  const logPrefix = `group=${groupSessionId.slice(0, 8)} slot=${slot.id}`;
  log("GROUP_SLOT_START", `${logPrefix} engine=openclaw agentId=${slot.agentId ?? "default"}`);

  const groupState = activeGroupSessions.get(groupSessionId);
  groupState?.slotSessionIds.add(sessionId);

  try {
    const result = await openclawGroupQuery(getMainWindow, slot.agentId || "default", prompt);
    log("GROUP_SLOT_DONE", `${logPrefix} result_len=${result.length}`);
    return result;
  } catch (err) {
    reportError("GROUP_SLOT_OPENCLAW_ERR", err, { sessionId, groupSessionId, slotId: slot.id });
    return "(error)";
  } finally {
    groupState?.slotSessionIds.delete(sessionId);
  }
}

async function querySlot(
  slot: AgentSlot,
  prompt: string,
  conversationContext: string,
  cwd: string,
  groupSessionId: string,
  getMainWindow: () => BrowserWindow | null,
): Promise<string> {
  const allSlots = activeGroupSessions.get(groupSessionId)?.session
    ? (() => {
        const group = loadGroup(activeGroupSessions.get(groupSessionId)!.session.groupId);
        return group?.slots ?? [];
      })()
    : [];
  const otherNames = allSlots.filter((s) => s.id !== slot.id).map((s) => s.label);
  const teamInfo = otherNames.length > 0
    ? `\nYou are "${slot.label}". The other team members are: ${otherNames.join(", ")}. You can mention them by name (e.g. "@${otherNames[0]}") to direct questions or comments to them.`
    : "";

  const fullPrompt = conversationContext
    ? `${conversationContext}\n\n---${teamInfo}\n\nNow respond to this as "${slot.label}" (${slot.model}):\n${prompt}`
    : `${teamInfo}\n${prompt}`;

  const passInstruction = `\n\nIMPORTANT: If you have nothing new to add to the conversation and the topic has been fully addressed, respond with exactly "[PASS]" and nothing else. Only pass if you truly have nothing meaningful to contribute.`;
  const promptWithPass = fullPrompt + passInstruction;

  if (slot.engine === "claude") {
    return startClaudeSlotSession(slot, promptWithPass, cwd, groupSessionId, getMainWindow);
  }
  if (slot.engine === "openclaw") {
    const systemInstructions = `You are "${slot.label}". You have access to all tools (read, edit, write, delete, search, bash). IMPORTANT: Work within the project directory "${cwd}" — all file paths must be relative to or inside this directory. When the task requires file operations or commands, execute them directly using your tools within this project scope. Summarize what you did after.`;
    const openclawPrompt = conversationContext
      ? `${systemInstructions}\n\n${conversationContext}\n\n---\n\nNow respond as "${slot.label}":\n${prompt}${passInstruction}`
      : `${systemInstructions}\n\n${prompt}${passInstruction}`;
    return startOpenClawSlotSession(slot, openclawPrompt, groupSessionId, getMainWindow);
  }
  if (slot.engine === "codex") {
    return `[Codex/${slot.model}] ${promptWithPass.slice(0, 200)}... (Codex group integration pending)`;
  }
  throw new Error(`Unsupported engine: ${slot.engine}`);
}

function buildConversationContext(messages: GroupMessage[], slots: AgentSlot[]): string {
  if (messages.length === 0) return "";
  const slotMap = new Map(slots.map((s) => [s.id, s]));
  const lines = messages.map((m) => {
    if (m.role === "user") return `[User]: ${m.content}`;
    const slot = slotMap.get(m.slotId);
    const label = slot?.label ?? m.slotId;
    return `[${label}]: ${m.content}`;
  });
  return "Previous conversation:\n" + lines.join("\n\n");
}

async function runGroupSession(
  getMainWindow: () => BrowserWindow | null,
  session: GroupSession,
  group: AgentGroup,
): Promise<void> {
  const state = activeGroupSessions.get(session.id);
  if (!state) return;

  const slots = group.slots;
  const leader = slots.find((s) => s.role === "leader");
  const members = slots.filter((s) => s.role === "member");

  state.session.status = "running";
  emit(getMainWindow, { type: "status", sessionId: session.id, status: "running" });
  log("GROUP_SESSION_RUN", `id=${session.id} turnOrder=${group.turnOrder} slots=${slots.length} cwd=${session.cwd}`);

  const cwd = session.cwd || process.cwd();

  while (!state.aborted) {
    state.session.currentTurnIndex++;
    const roundNum = state.session.currentTurnIndex;
    log("GROUP_ROUND_START", `id=${session.id} round=${roundNum}`);

    if (group.turnOrder === "chat") {
      const context = buildConversationContext(state.session.messages, slots);
      const promises = slots.map(async (slot) => {
        if (state.aborted) return;
        let content: string;
        try {
          content = await querySlot(slot, session.prompt, context, cwd, session.id, getMainWindow);
        } catch (err) {
          content = `(error: ${String(err)})`;
        }
        if (state.aborted) return;
        const msg: GroupMessage = {
          id: createMessageId(),
          slotId: slot.id,
          role: "assistant",
          content,
          timestamp: new Date().toISOString(),
          turnIndex: roundNum,
        };
        state.session.messages.push(msg);
        emit(getMainWindow, { type: "message", sessionId: session.id, slotId: slot.id, message: msg });
      });
      await Promise.allSettled(promises);
      break;
    } else if (group.turnOrder === "parallel") {
      const context = buildConversationContext(state.session.messages, slots);
      const promises = slots.map(async (slot) => {
        if (state.aborted) return;
        let content: string;
        try {
          content = await querySlot(slot, session.prompt, context, cwd, session.id, getMainWindow);
        } catch (err) {
          content = `(error: ${String(err)})`;
        }
        if (state.aborted) return;
        const msg: GroupMessage = {
          id: createMessageId(),
          slotId: slot.id,
          role: "assistant",
          content,
          timestamp: new Date().toISOString(),
          turnIndex: roundNum,
        };
        state.session.messages.push(msg);
        emit(getMainWindow, { type: "message", sessionId: session.id, slotId: slot.id, message: msg });
      });
      await Promise.allSettled(promises);

    } else if (group.turnOrder === "round-robin") {
      for (const slot of slots) {
        if (state.aborted) break;
        const context = buildConversationContext(state.session.messages, slots);
        let content: string;
        try {
          content = await querySlot(slot, session.prompt, context, cwd, session.id, getMainWindow);
        } catch (err) {
          content = `(error: ${String(err)})`;
        }
        if (state.aborted) break;
        const msg: GroupMessage = {
          id: createMessageId(),
          slotId: slot.id,
          role: "assistant",
          content,
          timestamp: new Date().toISOString(),
          turnIndex: roundNum,
        };
        state.session.messages.push(msg);
        emit(getMainWindow, { type: "message", sessionId: session.id, slotId: slot.id, message: msg });
      }

    } else if (group.turnOrder === "leader-decides") {
      const effectiveMembers = members.length > 0 ? members : slots.filter((s) => s !== leader);
      const memberNames = effectiveMembers.map((m) => m.label).join(", ");

      if (leader && !state.aborted) {
        state.session.status = "waiting-leader";
        emit(getMainWindow, { type: "status", sessionId: session.id, status: "waiting-leader" });
        const context = buildConversationContext(state.session.messages, slots);
        const leaderPrompt =
          `You are the group leader "${leader.label}". You COORDINATE the team — you do NOT do the work yourself. Your team members are: ${memberNames}.\n\nYour job is to:\n1. Give a brief direction/instruction to your team\n2. ALWAYS end your message with EXACTLY ONE of these directives on its own line:\n   [PARALLEL] — all members research/work simultaneously (DEFAULT for most tasks)\n   [SEQUENTIAL] — members discuss one by one, building on each other\n   [PASS] — conversation is done, no more work needed\n\nYou MUST include one of [PARALLEL], [SEQUENTIAL], or [PASS] as the LAST LINE of your response. If you forget, the team cannot proceed. When the user asks the team to research or work on something, delegate it with [PARALLEL]. When they need to debate, use [SEQUENTIAL].\n\nOriginal prompt: ${session.prompt}`;
        let leaderContent: string;
        try {
          leaderContent = await querySlot(leader, leaderPrompt, context, cwd, session.id, getMainWindow);
        } catch (err) {
          leaderContent = `(error: ${String(err)})`;
        }
        if (!state.aborted) {
          const msg: GroupMessage = {
            id: createMessageId(),
            slotId: leader.id,
            role: "assistant",
            content: leaderContent,
            timestamp: new Date().toISOString(),
            turnIndex: roundNum,
          };
          state.session.messages.push(msg);
          emit(getMainWindow, { type: "message", sessionId: session.id, slotId: leader.id, message: msg });
        }
        state.session.status = "running";
        emit(getMainWindow, { type: "status", sessionId: session.id, status: "running" });

        const hasParallel = leaderContent.includes("[PARALLEL]");
        const hasSequential = leaderContent.includes("[SEQUENTIAL]");
        const leaderPassed = leaderContent.trim() === "[PASS]" || leaderContent.includes("[PASS]");
        const useParallel = hasParallel || (!hasSequential && !leaderPassed);

        if (leaderPassed || state.aborted) {
          log("GROUP_LEADER_PASS", `id=${session.id} round=${roundNum}`);
        } else if (useParallel) {
          log("GROUP_LEADER_DIRECTIVE", `id=${session.id} round=${roundNum} mode=parallel`);
          const memberContext = buildConversationContext(state.session.messages, slots);
          const promises = effectiveMembers.map(async (member) => {
            if (state.aborted) return;
            let content: string;
            try {
              content = await querySlot(member, session.prompt, memberContext, cwd, session.id, getMainWindow);
            } catch (err) {
              content = `(error: ${String(err)})`;
            }
            if (state.aborted) return;
            const memberMsg: GroupMessage = {
              id: createMessageId(),
              slotId: member.id,
              role: "assistant",
              content,
              timestamp: new Date().toISOString(),
              turnIndex: roundNum,
            };
            state.session.messages.push(memberMsg);
            emit(getMainWindow, { type: "message", sessionId: session.id, slotId: member.id, message: memberMsg });
          });
          await Promise.allSettled(promises);
        } else {
          log("GROUP_LEADER_DIRECTIVE", `id=${session.id} round=${roundNum} mode=sequential`);
          for (const member of effectiveMembers) {
            if (state.aborted) break;
            const memberContext = buildConversationContext(state.session.messages, slots);
            let content: string;
            try {
              content = await querySlot(member, session.prompt, memberContext, cwd, session.id, getMainWindow);
            } catch (err) {
              content = `(error: ${String(err)})`;
            }
            if (state.aborted) break;
            const memberMsg: GroupMessage = {
              id: createMessageId(),
              slotId: member.id,
              role: "assistant",
              content,
              timestamp: new Date().toISOString(),
              turnIndex: roundNum,
            };
            state.session.messages.push(memberMsg);
            emit(getMainWindow, { type: "message", sessionId: session.id, slotId: member.id, message: memberMsg });
          }
        }
      }
    }

    emit(getMainWindow, {
      type: "turn-advance",
      sessionId: session.id,
      turnIndex: roundNum,
    });

    const roundMessages = state.session.messages.filter(
      (m) => m.turnIndex === roundNum && m.role === "assistant",
    );
    const allPassed = roundMessages.length > 0 && roundMessages.every(
      (m) => m.content.trim() === "[PASS]",
    );
    log("GROUP_ROUND_DONE", `id=${session.id} round=${roundNum} allPassed=${allPassed}`);
    if (allPassed) {
      log("GROUP_CONSENSUS_REACHED", `id=${session.id} after ${roundNum} rounds`);
      break;
    }
  }

  state.session.status = "completed";
  emit(getMainWindow, { type: "complete", sessionId: session.id, status: "completed" });

  if (state.projectId) {
    saveGroupSessionAsPersistedSession(state.session, state.projectId, state.groupName ?? group.name, group.slots);
  }
  saveGroupSession(state.session);
}

function saveGroup(group: AgentGroup): void {
  const filePath = path.join(getGroupsDir(), `${group.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(group, null, 2));
}

function loadGroup(groupId: string): AgentGroup | null {
  const filePath = path.join(getGroupsDir(), `${groupId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function listGroups(): AgentGroup[] {
  const dir = getGroupsDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")));
}

function deleteGroup(groupId: string): void {
  const filePath = path.join(getGroupsDir(), `${groupId}.json`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function saveGroupSession(session: GroupSession): void {
  const filePath = path.join(getGroupSessionsDir(), `${session.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
}

async function generateTeamConfig(prompt: string, cwd: string): Promise<{ result?: string; error?: string }> {
  const query = await getSDK();
  const cliPath = await getClaudeBinaryPath();

  let assistantText = "";
  const q = query({
    prompt,
    options: {
      cwd,
      model: "haiku",
      maxTurns: 1,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      persistSession: false,
      pathToClaudeCodeExecutable: cliPath,
      env: { ...process.env, ...clientAppEnv() },
    },
  });

  const timeout = setTimeout(() => {
    try { q.close(); } catch {}
  }, 30_000);

  try {
    for await (const msg of q) {
      const m = msg as Record<string, unknown>;
      if (m.type === "assistant") {
        const message = m.message as { content?: Array<{ type: string; text?: string }> } | undefined;
        if (message?.content) {
          for (const block of message.content) {
            if (block.type === "text" && block.text) assistantText += block.text;
          }
        }
      }
      if (m.type === "result" && typeof m.result === "string") {
        clearTimeout(timeout);
        return { result: m.result || assistantText };
      }
    }
  } catch (err) {
    clearTimeout(timeout);
    return { error: String(err) };
  }

  clearTimeout(timeout);
  return assistantText ? { result: assistantText } : { error: "No result" };
}

export function registerGroupSessionHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("group:list", () => {
    try {
      return { ok: true, groups: listGroups() };
    } catch (err) {
      return { ok: false, error: reportError("GROUP_LIST_ERR", err) };
    }
  });

  ipcMain.handle("group:create", (_event, group: AgentGroup) => {
    try {
      group.createdAt = new Date().toISOString();
      group.updatedAt = group.createdAt;
      saveGroup(group);
      log("GROUP_CREATE", { id: group.id, name: group.name, slots: group.slots.length });
      return { ok: true, group };
    } catch (err) {
      return { ok: false, error: reportError("GROUP_CREATE_ERR", err) };
    }
  });

  ipcMain.handle("group:update", (_event, group: AgentGroup) => {
    try {
      group.updatedAt = new Date().toISOString();
      saveGroup(group);
      return { ok: true, group };
    } catch (err) {
      return { ok: false, error: reportError("GROUP_UPDATE_ERR", err) };
    }
  });

  ipcMain.handle("group:delete", (_event, groupId: string) => {
    try {
      deleteGroup(groupId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: reportError("GROUP_DELETE_ERR", err) };
    }
  });

  ipcMain.handle(
    "group:start-session",
    async (_event, { groupId, prompt, cwd, projectId }: { groupId: string; prompt: string; cwd?: string; projectId?: string }) => {
      try {
        const group = loadGroup(groupId);
        if (!group) return { ok: false, error: "Group not found" };

        const session: GroupSession = {
          id: `gs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          groupId,
          status: "idle",
          messages: [
            {
              id: createMessageId(),
              slotId: "user",
              role: "user",
              content: prompt,
              timestamp: new Date().toISOString(),
              turnIndex: 0,
            },
          ],
          currentTurnIndex: 0,
          currentSlotIndex: 0,
          prompt,
          cwd,
          startedAt: new Date().toISOString(),
        };

        activeGroupSessions.set(session.id, {
          session,
          aborted: false,
          projectId,
          groupName: group.name,
          slotSessionIds: new Set(),
        });
        log("GROUP_SESSION_START", { sessionId: session.id, groupId, projectId, slots: group.slots.length });

        runGroupSession(getMainWindow, session, group).catch((err) => {
          reportError("GROUP_SESSION_RUN_ERR", err, { sessionId: session.id });
        });

        return { ok: true, sessionId: session.id };
      } catch (err) {
        return { ok: false, error: reportError("GROUP_SESSION_START_ERR", err) };
      }
    },
  );

  ipcMain.handle("group:generate-team", async (_event, { prompt, cwd }: { prompt: string; cwd?: string }) => {
    try {
      log("GROUP_GENERATE_TEAM", `prompt_len=${prompt.length}`);
      const { result, error } = await generateTeamConfig(prompt, cwd || process.cwd());
      if (error) return { ok: false, error };
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: reportError("GROUP_GENERATE_TEAM_ERR", err) };
    }
  });

  ipcMain.handle("group:stop-session", (_event, sessionId: string) => {
    const state = activeGroupSessions.get(sessionId);
    if (state) {
      state.aborted = true;
      state.session.status = "completed";

      for (const slotSessionId of state.slotSessionIds) {
        const claudeSession = claudeSessions.get(slotSessionId);
        if (claudeSession) {
          claudeSession.stopping = true;
          claudeSession.stopReason = "group-stopped";
          for (const [, pending] of claudeSession.pendingPermissions) {
            pending.resolve({ behavior: "deny", message: "Group session stopped" });
          }
          claudeSession.pendingPermissions.clear();
          claudeSession.channel.close();
          claudeSession.queryHandle?.close();
        }
      }

      if (state.projectId) {
        const group = loadGroup(state.session.groupId);
        if (group) {
          saveGroupSessionAsPersistedSession(state.session, state.projectId, state.groupName ?? group.name, group.slots);
        }
      }
      saveGroupSession(state.session);
      activeGroupSessions.delete(sessionId);
      emit(getMainWindow, { type: "status", sessionId, status: "completed" });
    }
    return { ok: true };
  });

  ipcMain.handle("group:get-session", (_event, sessionId: string) => {
    const state = activeGroupSessions.get(sessionId);
    if (state) return { ok: true, session: state.session };
    const filePath = path.join(getGroupSessionsDir(), `${sessionId}.json`);
    if (fs.existsSync(filePath)) {
      return { ok: true, session: JSON.parse(fs.readFileSync(filePath, "utf-8")) };
    }
    return { ok: false, error: "Session not found" };
  });

  ipcMain.handle(
    "group:resume",
    (_event, { sessionId, projectId }: { sessionId: string; projectId?: string }) => {
      if (activeGroupSessions.has(sessionId)) return { ok: true };

      const filePath = path.join(getGroupSessionsDir(), `${sessionId}.json`);
      let session: GroupSession | null = null;
      if (fs.existsSync(filePath)) {
        session = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      }
      if (!session) {
        const sessionFilePath = projectId ? getSessionFilePath(projectId, sessionId) : null;
        if (sessionFilePath && fs.existsSync(sessionFilePath)) {
          const persisted = JSON.parse(fs.readFileSync(sessionFilePath, "utf-8"));
          if (persisted.engine === "group" && persisted.groupId) {
            const group = loadGroup(persisted.groupId);
            session = {
              id: sessionId,
              groupId: persisted.groupId,
              status: "idle",
              messages: (persisted.messages ?? []).map((m: UIMessage) => ({
                id: m.id,
                slotId: m.groupSlot ? group?.slots.find((s: AgentSlot) => s.label === m.groupSlot?.label)?.id ?? "user" : "user",
                role: m.role === "assistant" ? "assistant" : "user",
                content: m.content,
                timestamp: typeof m.timestamp === "number" ? new Date(m.timestamp).toISOString() : String(m.timestamp),
                turnIndex: 0,
              })) as GroupMessage[],
              currentTurnIndex: 0,
              currentSlotIndex: 0,
              prompt: persisted.messages?.find((m: UIMessage) => m.role === "user")?.content ?? "",
              cwd: undefined,
              startedAt: new Date(persisted.createdAt).toISOString(),
              slotSdkSessionIds: persisted.slotSdkSessionIds,
            };
          }
        }
      }
      if (!session) {
        return { ok: false, error: "Group session not found on disk" };
      }

      const group = loadGroup(session.groupId);
      activeGroupSessions.set(sessionId, {
        session,
        aborted: false,
        projectId,
        groupName: group?.name,
        slotSessionIds: new Set(),
      });
      log("GROUP_SESSION_RESUME", { sessionId, groupId: session.groupId, messages: session.messages.length });
      return { ok: true };
    },
  );

  function tryResumeGroupSession(sessionId: string, projectId?: string): boolean {
    if (activeGroupSessions.has(sessionId)) return true;

    const nativePath = path.join(getGroupSessionsDir(), `${sessionId}.json`);
    let session: GroupSession | null = null;
    if (fs.existsSync(nativePath)) {
      session = JSON.parse(fs.readFileSync(nativePath, "utf-8"));
    }
    if (!session && projectId) {
      const sessionFilePath = getSessionFilePath(projectId, sessionId);
      if (fs.existsSync(sessionFilePath)) {
        const persisted = JSON.parse(fs.readFileSync(sessionFilePath, "utf-8"));
        if (persisted.engine === "group" && persisted.groupId) {
          const group = loadGroup(persisted.groupId);
          session = {
            id: sessionId,
            groupId: persisted.groupId,
            status: "idle",
            messages: (persisted.messages ?? []).map((m: UIMessage) => ({
              id: m.id,
              slotId: m.groupSlot ? group?.slots.find((s: AgentSlot) => s.label === m.groupSlot?.label)?.id ?? "user" : "user",
              role: m.role === "assistant" ? "assistant" : "user",
              content: m.content,
              timestamp: typeof m.timestamp === "number" ? new Date(m.timestamp).toISOString() : String(m.timestamp),
              turnIndex: 0,
            })) as GroupMessage[],
            currentTurnIndex: 0,
            currentSlotIndex: 0,
            prompt: persisted.messages?.find((m: UIMessage) => m.role === "user")?.content ?? "",
            cwd: undefined,
            startedAt: new Date(persisted.createdAt).toISOString(),
            slotSdkSessionIds: persisted.slotSdkSessionIds,
          };
        }
      }
    }
    if (!session) return false;
    const group = loadGroup(session.groupId);
    activeGroupSessions.set(sessionId, {
      session,
      aborted: false,
      projectId,
      groupName: group?.name,
      slotSessionIds: new Set(),
    });
    return true;
  }

  ipcMain.handle("group:send", async (_event, { sessionId, message, projectId }: { sessionId: string; message: string; projectId?: string }) => {
    tryResumeGroupSession(sessionId, projectId);
    const state = activeGroupSessions.get(sessionId);
    if (!state) return { ok: false, error: "Group session not found" };

    const group = loadGroup(state.session.groupId);
    if (!group) return { ok: false, error: "Group not found" };

    const userMsg: GroupMessage = {
      id: createMessageId(),
      slotId: "user",
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
      turnIndex: state.session.currentTurnIndex + 1,
    };
    state.session.messages.push(userMsg);
    state.session.prompt = message;
    state.session.currentTurnIndex++;
    state.aborted = false;
    emit(getMainWindow, { type: "message", sessionId, slotId: "user", message: userMsg });

    runGroupSession(getMainWindow, state.session, group).catch((err) => {
      reportError("GROUP_SESSION_SEND_ERR", err, { sessionId });
    });

    return { ok: true };
  });

  ipcMain.handle("group:interrupt", (_event, sessionId: string) => {
    const state = activeGroupSessions.get(sessionId);
    if (!state) return { ok: false, error: "Group session not found" };

    state.aborted = true;

    for (const slotSessionId of state.slotSessionIds) {
      const claudeSession = claudeSessions.get(slotSessionId);
      if (claudeSession?.queryHandle) {
        try {
          claudeSession.queryHandle.interrupt();
        } catch {}
      }
    }

    emit(getMainWindow, { type: "status", sessionId, status: "completed" });
    return { ok: true };
  });

  ipcMain.handle(
    "group:permission-response",
    (_event, { sessionId, slotId, requestId, behavior }: { sessionId: string; slotId: string; requestId: string; behavior: string }) => {
      const slotSessionId = `${sessionId}-slot-${slotId}`;
      const claudeSession = claudeSessions.get(slotSessionId);
      if (!claudeSession) return { error: "Slot session not found" };

      const pending = claudeSession.pendingPermissions.get(requestId);
      if (!pending) return { error: "No pending permission request" };

      claudeSession.pendingPermissions.delete(requestId);
      if (behavior === "allow") {
        pending.resolve({ behavior: "allow" });
      } else {
        pending.resolve({ behavior: "deny", message: "Denied by user" });
      }
      return { ok: true };
    },
  );
}
