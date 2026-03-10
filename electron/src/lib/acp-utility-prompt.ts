import { log } from "./logger";
import { reportError } from "./error-utils";
import { acpSessions } from "../ipc/acp-sessions";

/**
 * Send a one-shot prompt through an existing ACP session's connection.
 * Creates an ephemeral utility session on the same agent process, sends the prompt,
 * accumulates text from agent_message_chunk events, and returns the result.
 * Permissions are auto-denied since utility sessions are text-only.
 */
export async function acpUtilityPrompt(
  internalId: string,
  prompt: string,
  timeoutMs = 15000,
): Promise<string> {
  const entry = acpSessions.get(internalId);
  if (!entry) {
    throw new Error("ACP session not found");
  }

  const conn = entry.connection as {
    newSession: (params: { cwd: string }) => Promise<{ sessionId: string }>;
    prompt: (params: { sessionId: string; prompt: Array<{ type: string; text: string }> }) => Promise<{ stopReason: string }>;
    cancel: (params: { sessionId: string }) => Promise<unknown>;
  };

  // Create ephemeral utility session on the same connection (no extra process spawn)
  const utilitySession = await conn.newSession({ cwd: entry.cwd });
  const utilitySessionId = utilitySession.sessionId;
  log("ACP_UTILITY", `Created utility session ${utilitySessionId.slice(0, 12)} on connection ${internalId.slice(0, 8)}`);

  // Register so sessionUpdate callback knows to accumulate text, not forward to renderer
  if (!entry.utilitySessionIds) entry.utilitySessionIds = new Set();
  entry.utilitySessionIds.add(utilitySessionId);

  if (!entry.utilityTextBuffers) entry.utilityTextBuffers = new Map();
  entry.utilityTextBuffers.set(utilitySessionId, "");

  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    conn.cancel({ sessionId: utilitySessionId }).catch(() => {});
  }, timeoutMs);

  try {
    await conn.prompt({
      sessionId: utilitySessionId,
      prompt: [{ type: "text", text: prompt }],
    });

    clearTimeout(timeoutHandle);

    if (timedOut) {
      throw new Error("ACP utility prompt timed out");
    }

    const result = entry.utilityTextBuffers.get(utilitySessionId) ?? "";
    log("ACP_UTILITY", `Utility session ${utilitySessionId.slice(0, 12)} result len=${result.length}`);
    return result;
  } catch (err) {
    clearTimeout(timeoutHandle);
    reportError("ACP_UTILITY_ERR", err, { internalId });
    throw err;
  } finally {
    // Clean up this utility session — don't null the collections since another
    // concurrent utility prompt may still be active on the same connection
    entry.utilitySessionIds?.delete(utilitySessionId);
    entry.utilityTextBuffers?.delete(utilitySessionId);
  }
}
