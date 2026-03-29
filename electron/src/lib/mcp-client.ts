import { spawn, type ChildProcess } from "child_process";
import { log } from "./logger";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolsListResult {
  tools: McpTool[];
}

interface McpToolCallResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export class McpClient {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private connected = false;
  private transport: "stdio" | "http" | "sse";
  private url: string | undefined;
  private headers: Record<string, string>;
  private command: string | undefined;
  private args: string[];
  private env: Record<string, string> | undefined;
  private serverName: string;

  constructor(config: {
    name: string;
    transport: "stdio" | "http" | "sse";
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  }) {
    this.serverName = config.name;
    this.transport = config.transport;
    this.command = config.command;
    this.args = config.args ?? [];
    this.env = config.env;
    this.url = config.url;
    this.headers = config.headers ?? {};
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    if (this.transport === "stdio") {
      await this.connectStdio();
    }

    await this.initialize();
    this.connected = true;
    log("MCP_CLIENT", `connected to ${this.serverName} (${this.transport})`);
  }

  private connectStdio(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.command) {
        reject(new Error(`No command configured for stdio server ${this.serverName}`));
        return;
      }

      const proc = spawn(this.command, this.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...this.env },
      });

      proc.on("error", (err) => {
        log("MCP_CLIENT", `${this.serverName} spawn error: ${err.message}`);
        reject(err);
      });

      proc.on("exit", (code) => {
        log("MCP_CLIENT", `${this.serverName} exited with code ${code}`);
        this.connected = false;
        this.process = null;
        for (const [, p] of this.pending) {
          p.reject(new Error(`MCP server ${this.serverName} exited`));
        }
        this.pending.clear();
      });

      proc.stderr?.on("data", (data: Buffer) => {
        log("MCP_CLIENT", `${this.serverName} stderr: ${data.toString().trim()}`);
      });

      proc.stdout?.on("data", (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.process = proc;
      resolve();
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse;
        if (msg.id != null) {
          const pending = this.pending.get(msg.id);
          if (pending) {
            this.pending.delete(msg.id);
            pending.resolve(msg);
          }
        }
      } catch {
        // skip non-JSON lines (notifications, etc)
      }
    }
  }

  private async sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };

    if (this.transport === "stdio") {
      return this.sendStdio(request);
    }
    return this.sendHttp(request);
  }

  private sendStdio(request: JsonRpcRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error(`MCP server ${this.serverName} stdin not writable`));
        return;
      }

      const timeout = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error(`MCP request ${request.method} timed out on ${this.serverName}`));
      }, 30_000);

      this.pending.set(request.id, {
        resolve: (response) => {
          clearTimeout(timeout);
          if (response.error) {
            reject(new Error(`MCP error from ${this.serverName}: ${response.error.message}`));
          } else {
            resolve(response.result);
          }
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.process.stdin.write(JSON.stringify(request) + "\n");
    });
  }

  private async sendHttp(request: JsonRpcRequest): Promise<unknown> {
    if (!this.url) throw new Error(`No URL configured for ${this.serverName}`);

    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...this.headers,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`MCP HTTP ${response.status} from ${this.serverName}`);
    }

    const body = (await response.json()) as JsonRpcResponse;
    if (body.error) {
      throw new Error(`MCP error from ${this.serverName}: ${body.error.message}`);
    }
    return body.result;
  }

  private async initialize(): Promise<void> {
    await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "Harnss", version: "1.0" },
    });

    if (this.transport === "stdio") {
      this.process?.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    }
  }

  async listTools(): Promise<McpTool[]> {
    const result = (await this.sendRequest("tools/list")) as McpToolsListResult;
    return result?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = (await this.sendRequest("tools/call", { name, arguments: args })) as McpToolCallResult;

    if (result?.isError) {
      const text = result.content?.map((c) => c.text ?? "").join("\n") || "Tool call failed";
      throw new Error(text);
    }

    return result?.content?.map((c) => c.text ?? "").join("\n") ?? "";
  }

  disconnect(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.connected = false;
    for (const [, p] of this.pending) {
      p.reject(new Error("Disconnected"));
    }
    this.pending.clear();
    log("MCP_CLIENT", `disconnected from ${this.serverName}`);
  }

  get isConnected(): boolean {
    return this.connected;
  }
}
