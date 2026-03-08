import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockApp,
  mockGetAppSetting,
  mockExistsSync,
  mockLog,
} = vi.hoisted(() => ({
  mockApp: {
    isPackaged: false,
    getVersion: vi.fn(() => "0.16.0"),
    getAppPath: vi.fn(() => "/Applications/Harnss.app/Contents/Resources/app.asar"),
  },
  mockGetAppSetting: vi.fn(() => "Harnss"),
  mockExistsSync: vi.fn(() => false),
  mockLog: vi.fn(),
}));

vi.mock("electron", () => ({
  app: mockApp,
}));

vi.mock("fs", () => ({
  default: {
    existsSync: mockExistsSync,
  },
}));

vi.mock("../app-settings", () => ({
  getAppSetting: mockGetAppSetting,
}));

vi.mock("../logger", () => ({
  log: mockLog,
}));

async function loadSdkModule() {
  vi.resetModules();
  return import("../sdk");
}

describe("sdk path resolution", () => {
  beforeEach(() => {
    mockApp.isPackaged = false;
    mockApp.getAppPath.mockReset();
    mockApp.getAppPath.mockReturnValue("/Applications/Harnss.app/Contents/Resources/app.asar");
    mockGetAppSetting.mockReset();
    mockGetAppSetting.mockReturnValue("Harnss");
    mockExistsSync.mockReset();
    mockExistsSync.mockReturnValue(false);
    mockLog.mockReset();
  });

  it("derives cli.js from an exported SDK entrypoint in dev", async () => {
    const mod = await loadSdkModule();

    expect(
      mod.resolveCliPathFromEntry("/x/node_modules/@anthropic-ai/claude-agent-sdk/embed.js", false),
    ).toBe("/x/node_modules/@anthropic-ai/claude-agent-sdk/cli.js");
  });

  it("maps packaged app paths to app.asar.unpacked", async () => {
    const mod = await loadSdkModule();

    expect(
      mod.resolveCliPathFromEntry(
        "/Applications/Harnss.app/Contents/Resources/app.asar/node_modules/@anthropic-ai/claude-agent-sdk/embed.js",
        true,
      ),
    ).toBe(
      "/Applications/Harnss.app/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
    );
  });

  it("prefers embed resolution when the candidate exists", async () => {
    const embedEntry = require.resolve("@anthropic-ai/claude-agent-sdk/embed");
    const embedCliPath = path.join(path.dirname(embedEntry), "cli.js");
    mockExistsSync.mockImplementation((candidate: unknown) => candidate === embedCliPath);

    const mod = await loadSdkModule();

    expect(mod.getCliPath()).toBe(embedCliPath);
    expect(mockLog).toHaveBeenCalledWith("CLI_PATH_SELECTED", `strategy=embed path=${embedCliPath}`);
  });

  it("falls back to package entry resolution when embed resolution is unavailable", async () => {
    const packageEntry = require.resolve("@anthropic-ai/claude-agent-sdk");
    const packageCliPath = path.join(path.dirname(packageEntry), "cli.js");
    mockExistsSync.mockReturnValueOnce(false).mockReturnValueOnce(true);

    const mod = await loadSdkModule();

    expect(mod.getCliPath()).toBe(packageCliPath);
    expect(mockLog).toHaveBeenCalledWith("CLI_PATH_SELECTED", `strategy=package path=${packageCliPath}`);
  });

  it("falls back to the packaged app path only after SDK-based strategies fail", async () => {
    mockApp.isPackaged = true;
    const packagedCliPath = "/Applications/Harnss.app/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js";
    mockExistsSync.mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValueOnce(true);

    const mod = await loadSdkModule();

    expect(mod.getCliPath()).toBe(packagedCliPath);
    expect(mockLog).toHaveBeenCalledWith("CLI_PATH_SELECTED", `strategy=app-path path=${packagedCliPath}`);
  });

  it("returns undefined when no candidate exists", async () => {
    mockApp.isPackaged = true;
    mockExistsSync.mockReturnValue(false);

    const mod = await loadSdkModule();

    expect(mod.getCliPath()).toBeUndefined();
    expect(mockLog).toHaveBeenCalledWith(
      "CLI_PATH_MISSING",
      "No valid Claude CLI path resolved; SDK fallback may fail in packaged apps",
    );
  });

  it("formats the Claude client app header from settings and app version", async () => {
    mockGetAppSetting.mockReturnValue("Codex Desktop");
    const mod = await loadSdkModule();

    expect(mod.clientAppEnv()).toEqual({
      CLAUDE_AGENT_SDK_CLIENT_APP: "Codex Desktop/0.16.0",
    });
  });
});
