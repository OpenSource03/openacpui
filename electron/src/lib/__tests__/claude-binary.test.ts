import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAccessSync,
  mockExecFileSync,
  mockGetAppSetting,
  mockGetCliPath,
  mockLog,
  mockSpawn,
} = vi.hoisted(() => ({
  mockAccessSync: vi.fn(),
  mockExecFileSync: vi.fn(),
  mockGetAppSetting: vi.fn<(key: string) => string>((key: string) => {
    if (key === "claudeBinarySource") return "auto";
    if (key === "claudeCustomBinaryPath") return "";
    return "Harnss";
  }),
  mockGetCliPath: vi.fn(() => "/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js"),
  mockLog: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock("fs", () => ({
  default: {
    accessSync: mockAccessSync,
    constants: { X_OK: 1 },
  },
}));

vi.mock("os", () => ({
  default: {
    homedir: () => "/Users/tester",
  },
}));

vi.mock("child_process", () => ({
  execFileSync: mockExecFileSync,
  spawn: mockSpawn,
}));

vi.mock("../app-settings", () => ({
  getAppSetting: mockGetAppSetting,
}));

vi.mock("../sdk", () => ({
  getCliPath: mockGetCliPath,
}));

vi.mock("../logger", () => ({
  log: mockLog,
}));

function allowExecutable(...filePaths: string[]): void {
  mockAccessSync.mockImplementation((candidate: string) => {
    if (filePaths.includes(candidate)) return;
    throw new Error("missing");
  });
}

async function loadModule() {
  vi.resetModules();
  return import("../claude-binary");
}

describe("claude binary resolution", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mockAccessSync.mockReset();
    mockExecFileSync.mockReset();
    mockGetAppSetting.mockReset();
    mockGetAppSetting.mockImplementation((key: string): string => {
      if (key === "claudeBinarySource") return "auto";
      if (key === "claudeCustomBinaryPath") return "";
      return "Harnss";
    });
    mockGetCliPath.mockReset();
    mockGetCliPath.mockReturnValue("/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js");
    mockLog.mockReset();
    mockSpawn.mockReset();
  });

  it("uses a valid custom executable path", async () => {
    mockGetAppSetting.mockImplementation((key: string): string => {
      if (key === "claudeBinarySource") return "custom";
      if (key === "claudeCustomBinaryPath") return "/opt/bin/claude";
      return "Harnss";
    });
    allowExecutable("/opt/bin/claude");

    const mod = await loadModule();

    await expect(mod.getClaudeBinaryPath()).resolves.toBe("/opt/bin/claude");
  });

  it("prefers the env override in auto mode", async () => {
    vi.stubEnv("CLAUDE_CODE_CLI_PATH", "/env/claude");
    allowExecutable("/env/claude");

    const mod = await loadModule();

    await expect(mod.getClaudeBinaryPath({ installIfMissing: false })).resolves.toBe("/env/claude");
  });

  it("finds the native shim in the user local bin directory", async () => {
    allowExecutable("/Users/tester/.local/bin/claude");

    const mod = await loadModule();

    await expect(mod.getClaudeBinaryPath({ installIfMissing: false })).resolves.toBe("/Users/tester/.local/bin/claude");
  });

  it("falls back to PATH lookup when the shim is missing", async () => {
    mockExecFileSync.mockImplementation((command: string) => {
      if (command === "which") return "/usr/local/bin/claude\n";
      throw new Error("unexpected");
    });
    allowExecutable("/usr/local/bin/claude");

    const mod = await loadModule();

    await expect(mod.getClaudeBinaryPath({ installIfMissing: false })).resolves.toBe("/usr/local/bin/claude");
  });

  it("uses the sdk cli fallback in auto mode when native resolution fails", async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("missing");
    });
    allowExecutable("/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js");

    const mod = await loadModule();

    await expect(mod.getClaudeBinaryPath({ installIfMissing: false, allowSdkFallback: true })).resolves.toBe(
      "/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
    );
    expect(mockLog).toHaveBeenCalledWith(
      "CLAUDE_BINARY_SELECTED",
      "strategy=sdk-fallback path=/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
    );
  });

  it("reports status without triggering install", async () => {
    allowExecutable("/Users/tester/.local/bin/claude");
    const mod = await loadModule();

    expect(mod.getClaudeBinaryStatus()).toEqual({
      installed: true,
      installing: false,
    });
  });

  it("returns a version when the sdk fallback path is a script", async () => {
    mockExecFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === process.execPath) {
        expect(args).toEqual(["/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js", "--version"]);
        return "2.1.70\n";
      }
      throw new Error("unexpected");
    });
    allowExecutable("/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js");

    const mod = await loadModule();

    await expect(mod.getClaudeVersion()).resolves.toBe("2.1.70");
  });
});
