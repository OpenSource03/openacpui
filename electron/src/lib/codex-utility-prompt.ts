import { spawn } from "child_process";
import { CodexRpcClient } from "./codex-rpc";
import { getCodexBinaryPath } from "./codex-binary";
import { log } from "./logger";
import { reportError } from "./error-utils";
import type {
  CodexInitializeResponse,
  CodexModel,
  CodexModelListResponse,
  CodexThreadStartResponse,
  CodexTurnStartResponse,
} from "@shared/types/codex";

interface CodexUtilityPromptOptions {
  timeoutMs?: number;
  model?: string;
}

function pickModelId(
  requestedModel: string | undefined,
  models: Array<CodexModel>,
): string | undefined {
  const requested = typeof requestedModel === "string" ? requestedModel.trim() : "";
  if (requested.length > 0) {
    const found = models.find((m) => m.id === requested);
    if (found) return found.id;
  }
  const defaultModel = models.find((m) => m.isDefault === true);
  if (defaultModel) return defaultModel.id;
  return models[0]?.id;
}

/** Run a one-shot Codex turn and return aggregated assistant text. */
export async function codexUtilityPrompt(
  prompt: string,
  cwd: string,
  logLabel: string,
  options?: CodexUtilityPromptOptions,
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? 60000;
  const startedAt = Date.now();

  let rpc: CodexRpcClient | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    const codexPath = await getCodexBinaryPath();
    const proc = spawn(codexPath, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
      env: {
        ...process.env,
        RUST_LOG: process.env.RUST_LOG ?? "warn",
      },
    });

    if (!proc.pid) {
      throw new Error("Failed to spawn codex app-server process");
    }

    rpc = new CodexRpcClient(proc);
    log("CODEX_UTILITY", `${logLabel} start pid=${proc.pid} cwd=${cwd} prompt_len=${prompt.length}`);

    let collectedDelta = "";
    let completedAgentMessage = "";
    let activeTurnId: string | null = null;

    let settle: ((result: string) => void) | null = null;
    let fail: ((error: Error) => void) | null = null;
    let isSettled = false;

    const completionPromise = new Promise<string>((resolve, reject) => {
      settle = (result: string) => {
        if (isSettled) return;
        isSettled = true;
        resolve(result);
      };
      fail = (error: Error) => {
        if (isSettled) return;
        isSettled = true;
        reject(error);
      };
    });

    rpc.onStderr = (text) => {
      log(`${logLabel}_STDERR`, text);
    };

    rpc.onNotification = (msg) => {
      if (!settle || !fail) return;

      if (msg.method === "turn/started") {
        const params = msg.params as { turn?: { id?: string } };
        if (!activeTurnId && typeof params.turn?.id === "string") {
          activeTurnId = params.turn.id;
        }
        return;
      }

      if (msg.method === "item/agentMessage/delta") {
        const params = msg.params as { delta?: string };
        if (typeof params.delta === "string") {
          collectedDelta += params.delta;
        }
        return;
      }

      if (msg.method === "item/completed") {
        const params = msg.params as { item?: { type?: string; text?: string } };
        if (
          params.item?.type === "agentMessage" &&
          typeof params.item.text === "string" &&
          params.item.text.length > 0
        ) {
          completedAgentMessage = params.item.text;
        }
        return;
      }

      if (msg.method === "turn/completed") {
        const params = msg.params as {
          turn?: {
            id?: string;
            status?: string;
            error?: { message?: string | null } | null;
          };
        };
        const turn = params.turn;
        if (!turn || typeof turn.id !== "string") return;
        if (activeTurnId && turn.id !== activeTurnId) return;

        const status = turn.status ?? "unknown";
        if (status === "failed") {
          const reason = turn.error?.message?.trim() || "Codex turn failed";
          fail(new Error(reason));
          return;
        }

        const text = completedAgentMessage || collectedDelta;
        settle(text);
      }
    };

    timeoutHandle = setTimeout(() => {
      if (!fail) return;
      fail(new Error(`Codex utility prompt timed out after ${timeoutMs}ms`));
      try {
        rpc?.destroy();
      } catch {
        // ignore cleanup errors
      }
    }, timeoutMs);

    await rpc.request<CodexInitializeResponse>("initialize", {
      clientInfo: { name: "Harnss", title: "Harnss", version: "utility" },
      capabilities: { experimentalApi: true },
    });
    rpc.notify("initialized", {});

    let selectedModel: string | undefined;
    try {
      const models = await rpc.request<CodexModelListResponse>("model/list", { includeHidden: false });
      selectedModel = pickModelId(options?.model, models.data ?? []);
    } catch (err) {
      reportError("CODEX_UTILITY", err, { context: "model/list", logLabel });
    }

    const threadParams: Record<string, unknown> = {
      cwd,
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    };
    if (selectedModel) {
      threadParams.model = selectedModel;
    }
    const thread = await rpc.request<CodexThreadStartResponse>("thread/start", threadParams);

    const turnParams: Record<string, unknown> = {
      threadId: thread.thread.id,
      input: [{ type: "text", text: prompt }],
    };
    if (selectedModel) {
      turnParams.model = selectedModel;
    }
    const turn = await rpc.request<CodexTurnStartResponse>("turn/start", turnParams);
    activeTurnId = turn.turn.id;
    log(
      "CODEX_UTILITY",
      `${logLabel} thread=${thread.thread.id.slice(0, 12)} turn=${activeTurnId.slice(0, 12)} model=${selectedModel ?? "default"}`,
    );

    const output = await completionPromise;
    const elapsed = Date.now() - startedAt;
    log("CODEX_UTILITY", `${logLabel} completed elapsed_ms=${elapsed} output_len=${output.length}`);
    return output;
  } catch (err) {
    const message = reportError("CODEX_UTILITY_ERR", err, { logLabel });
    throw new Error(message);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (rpc) {
      try {
        rpc.destroy();
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

