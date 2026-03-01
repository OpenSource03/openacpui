import { ipcMain } from "electron";
import { log } from "../lib/logger";
import { getSDK, getCliPath, clientAppEnv } from "../lib/sdk";
import { extractErrorMessage } from "../lib/error-utils";
import { gitExec } from "../lib/git-exec";

/** Fire a one-shot SDK query and return the first-line result. */
async function oneShotSdkQuery(
  prompt: string,
  cwd: string,
  logLabel: string,
  extraOptions?: Record<string, unknown>,
): Promise<{ result?: string; error?: string }> {
  try {
    const query = await getSDK();

    const q = query({
      prompt,
      options: {
        cwd,
        model: "claude-haiku-4-5-20251001",
        maxTurns: 1,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        persistSession: false,
        pathToClaudeCodeExecutable: getCliPath(),
        env: { ...process.env, ...clientAppEnv() },
        ...extraOptions,
      },
    });

    const timeout = setTimeout(() => { q.close(); }, 15000);

    try {
      for await (const msg of q) {
        const m = msg as Record<string, unknown>;
        if (m.type === "result") {
          clearTimeout(timeout);
          const raw = ((m.result as string) || "").split("\n")[0].trim();
          log(logLabel, `Generated: "${raw}"`);
          return { result: raw || undefined, error: raw ? undefined : "empty result" };
        }
      }
    } catch (err) {
      clearTimeout(timeout);
      const errMsg = extractErrorMessage(err);
      log(`${logLabel}_ERR`, errMsg);
      return { error: errMsg };
    }

    clearTimeout(timeout);
    return { error: "No result received" };
  } catch (err) {
    const errMsg = extractErrorMessage(err);
    log(`${logLabel}_ERR`, `spawn error: ${errMsg}`);
    return { error: errMsg };
  }
}

export function register(): void {
  ipcMain.handle("claude:generate-title", async (_event, {
    message,
    cwd,
    engine,
    sessionId,
  }: {
    message: string;
    cwd?: string;
    engine?: "claude" | "acp" | "codex";
    sessionId?: string; // ACP internalId when engine === "acp"
  }) => {
    const truncatedMsg = message.length > 500 ? message.slice(0, 500) + "..." : message;
    const prompt = `Generate a very short title (3-7 words) for a chat that starts with this message. Reply with ONLY the title, no quotes, no punctuation at the end.\n\nMessage: ${truncatedMsg}`;

    log("TITLE_GEN", `engine=${engine ?? "claude"} session=${sessionId?.slice(0, 8) ?? "none"} msg="${truncatedMsg.slice(0, 80)}..."`);

    // ACP path: create utility session on existing agent connection
    if (engine === "acp" && sessionId) {
      try {
        const { acpUtilityPrompt } = await import("../lib/acp-utility-prompt");
        const raw = await acpUtilityPrompt(sessionId, prompt);
        const title = raw.split("\n")[0].trim();
        log("TITLE_GEN", `ACP generated: "${title}"`);
        return { title: title || undefined, error: title ? undefined : "empty result" };
      } catch (err) {
        const msg = extractErrorMessage(err);
        log("TITLE_GEN_ERR", `ACP: ${msg}`);
        return { error: msg };
      }
    }

    // Claude SDK path (default)
    log("TITLE_GEN", `Spawning SDK for: "${truncatedMsg.slice(0, 80)}..." cwd=${cwd}`);
    const { result, error } = await oneShotSdkQuery(prompt, cwd || process.cwd(), "TITLE_GEN");
    return { title: result, error };
  });

  ipcMain.handle("git:generate-commit-message", async (_event, {
    cwd,
    engine,
    sessionId,
  }: {
    cwd: string;
    engine?: "claude" | "acp" | "codex";
    sessionId?: string; // ACP internalId when engine === "acp"
  }) => {
    try {
      let diff: string;
      try {
        diff = (await gitExec(["diff", "--staged"], cwd)).trim();
      } catch { diff = ""; }
      if (!diff) {
        try {
          diff = (await gitExec(["diff"], cwd)).trim();
        } catch { diff = ""; }
      }
      if (!diff) {
        try {
          diff = (await gitExec(["status", "--short"], cwd)).trim();
        } catch { diff = ""; }
      }
      if (!diff) return { error: "No changes to describe" };

      const maxChars = 500000;
      const truncated = diff.length > maxChars ? diff.slice(0, maxChars) + "\n... (truncated)" : diff;

      const prompt = `Generate a commit message for the following diff. Follow any CLAUDE.md instructions for commit message format and style. Reply with ONLY the commit message, nothing else.\n\n${truncated}`;

      log("COMMIT_MSG_GEN", `engine=${engine ?? "claude"} generating for ${diff.length} chars of diff`);

      // ACP path: create utility session on existing agent connection
      if (engine === "acp" && sessionId) {
        try {
          const { acpUtilityPrompt } = await import("../lib/acp-utility-prompt");
          const raw = await acpUtilityPrompt(sessionId, prompt);
          const message = raw.split("\n")[0].trim();
          log("COMMIT_MSG_GEN", `ACP generated: "${message}"`);
          return { message: message || undefined, error: message ? undefined : "empty result" };
        } catch (err) {
          const msg = extractErrorMessage(err);
          log("COMMIT_MSG_GEN_ERR", `ACP: ${msg}`);
          return { error: msg };
        }
      }

      // Claude SDK path (default)
      const { result, error } = await oneShotSdkQuery(prompt, cwd, "COMMIT_MSG_GEN", {
        systemPrompt: { type: "preset", preset: "claude_code" },
        settingSources: ["project", "user"],
      });
      return { message: result, error };
    } catch (err) {
      log("COMMIT_MSG_GEN_ERR", `spawn error: ${extractErrorMessage(err)}`);
      return { error: extractErrorMessage(err) };
    }
  });
}
