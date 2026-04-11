import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted — these run BEFORE vi.mock factories (which are hoisted to top).
// Can't use top-level imports here, so require() is used for EventEmitter.
// ---------------------------------------------------------------------------

const {
  mockApp,
  mockWebContents,
  mockWindow,
  mockIpcHandlers,
  mockIpcMain,
  mockBrowserWindow,
  mockShell,
  mockPowerMonitor,
  mockAutoUpdater,
  updaterEmitter,
  settingsChangedCbRef,
} = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require("events") as typeof import("events");
  const emitter = new EventEmitter();

  const webContents = { send: vi.fn() };
  const win = { destroy: vi.fn(), webContents: webContents };
  const handlers = new Map<string, (...args: unknown[]) => unknown>();

  const app = {
    isPackaged: true,
    getPath: vi.fn((name: string) => {
      const paths: Record<string, string> = {
        appData: "/mock/Library/Application Support",
        exe: "/Applications/Harnss.app/Contents/MacOS/Harnss",
        temp: "/tmp",
      };
      return paths[name] ?? "/mock";
    }),
    getVersion: vi.fn(() => "0.12.0"),
    relaunch: vi.fn(),
    exit: vi.fn(),
    on: vi.fn(),
    quit: vi.fn(),
  };

  const autoUpdater = Object.assign(emitter, {
    logger: null as unknown,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    allowDowngrade: false,
    checkForUpdates: vi.fn().mockResolvedValue({}),
    downloadUpdate: vi.fn().mockResolvedValue(null),
    quitAndInstall: vi.fn(),
    // macOS-only internal property on MacUpdater
    squirrelDownloadedUpdate: undefined as boolean | undefined,
  });

  // Wrap in object so the callback reference can be mutated from inside vi.mock
  const cbRef = { current: null as ((s: { allowPrereleaseUpdates: boolean }) => void) | null };

  return {
    mockApp: app,
    mockWebContents: webContents,
    mockWindow: win,
    mockIpcHandlers: handlers,
    mockIpcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }),
    },
    mockBrowserWindow: { getAllWindows: vi.fn(() => [win]) },
    mockShell: { openExternal: vi.fn() },
    mockPowerMonitor: { on: vi.fn() },
    mockAutoUpdater: autoUpdater,
    updaterEmitter: emitter,
    settingsChangedCbRef: cbRef,
  };
});

// ---------------------------------------------------------------------------
// Mock: electron
// ---------------------------------------------------------------------------

vi.mock("electron", () => ({
  app: mockApp,
  ipcMain: mockIpcMain,
  BrowserWindow: mockBrowserWindow,
  shell: mockShell,
  powerMonitor: mockPowerMonitor,
}));

// ---------------------------------------------------------------------------
// Mock: electron-updater
// ---------------------------------------------------------------------------

vi.mock("electron-updater", () => ({
  autoUpdater: mockAutoUpdater,
}));

// ---------------------------------------------------------------------------
// Mock: internal dependencies
// ---------------------------------------------------------------------------

vi.mock("../logger", () => ({
  log: vi.fn(),
}));

vi.mock("../app-settings", () => ({
  getAppSetting: vi.fn(() => true),
}));

vi.mock("../../ipc/settings", () => ({
  onSettingsChanged: vi.fn((cb: (settings: { allowPrereleaseUpdates: boolean }) => void) => {
    settingsChangedCbRef.current = cb;
  }),
}));

// ---------------------------------------------------------------------------
// Mock: fs + child_process
// ---------------------------------------------------------------------------

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ mtimeMs: 0 })),
    accessSync: vi.fn(),
    mkdirSync: vi.fn(),
    renameSync: vi.fn(),
    rmSync: vi.fn(),
    constants: actual.constants,
  };
});

vi.mock("child_process", () => ({
  execFile: vi.fn(
    (
      _cmd: string,
      _args: string[],
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      cb(null, "", "");
    },
  ),
}));

// ---------------------------------------------------------------------------
// Import subjects (after all vi.mock calls)
// ---------------------------------------------------------------------------

import * as fs from "fs";
import { execFile } from "child_process";
import { app, BrowserWindow, shell, powerMonitor } from "electron";
import { log } from "../logger";
import { getAppSetting } from "../app-settings";
import {
  initAutoUpdater,
  getIsInstallingUpdate,
  getErrorMessage,
  checkForUpdates,
  maybeCheckForUpdates,
  findUpdateZip,
  __resetForTesting,
  STARTUP_UPDATE_CHECK_DELAY_MS,
  PERIODIC_UPDATE_CHECK_INTERVAL_MS,
  ACTIVE_UPDATE_CHECK_MIN_INTERVAL_MS,
} from "../updater";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalPlatform = process.platform;

function setPlatform(platform: string): void {
  Object.defineProperty(process, "platform", { value: platform, writable: true });
}

/** Call initAutoUpdater with a mock getMainWindow that returns our mock window. */
function init(): void {
  initAutoUpdater(() => mockWindow as unknown as import("electron").BrowserWindow);
}

/** Retrieve a captured IPC handler by channel name. */
function getHandler(channel: string): (...args: unknown[]) => unknown {
  const handler = mockIpcHandlers.get(channel);
  if (!handler) throw new Error(`No IPC handler registered for "${channel}"`);
  return handler;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  __resetForTesting();
  mockIpcHandlers.clear();
  updaterEmitter.removeAllListeners();
  mockAutoUpdater.squirrelDownloadedUpdate = undefined;
  mockAutoUpdater.allowDowngrade = false;
  mockAutoUpdater.checkForUpdates.mockReset().mockResolvedValue({});
  mockAutoUpdater.downloadUpdate.mockReset().mockResolvedValue(null);
  mockAutoUpdater.quitAndInstall.mockReset();
  mockWindow.destroy.mockReset();
  mockWebContents.send.mockReset();
  mockApp.getVersion.mockReturnValue("0.12.0");
  (app.on as Mock).mockReset();
  (powerMonitor.on as Mock).mockReset();
  (shell.openExternal as Mock).mockReset();
  (BrowserWindow.getAllWindows as Mock).mockReturnValue([mockWindow]);
  (fs.existsSync as Mock).mockReturnValue(false);
  (fs.readdirSync as Mock).mockReturnValue([]);
  (log as Mock).mockReset();
  (getAppSetting as Mock).mockReturnValue(true);
  settingsChangedCbRef.current = null;
});

afterEach(() => {
  vi.useRealTimers();
  setPlatform(originalPlatform);
});

// ===========================================================================
// Tests
// ===========================================================================

describe("getErrorMessage", () => {
  it("returns Error.message for Error instances", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns stringified value for non-Error objects", () => {
    expect(getErrorMessage({ code: 42 })).toBe("[object Object]");
  });

  it("returns string for string input", () => {
    expect(getErrorMessage("plain string")).toBe("plain string");
  });

  it("returns 'null' for null", () => {
    expect(getErrorMessage(null)).toBe("null");
  });

  it("returns 'undefined' for undefined", () => {
    expect(getErrorMessage(undefined)).toBe("undefined");
  });

  it("returns numeric string for numbers", () => {
    expect(getErrorMessage(404)).toBe("404");
  });
});

describe("findUpdateZip", () => {
  const cacheDir = "/mock/Library/Caches/harnss-updater/pending";

  it("returns null when cache directory does not exist", () => {
    (fs.existsSync as Mock).mockReturnValue(false);
    expect(findUpdateZip()).toBeNull();
  });

  it("finds exact version match when lastDownloadedVersion is set", () => {
    // Set lastDownloadedVersion via the update-downloaded event
    init();
    mockAutoUpdater.emit("update-downloaded", { version: "0.12.1" });

    (fs.existsSync as Mock).mockReturnValue(true);
    (fs.readdirSync as Mock).mockReturnValue([
      "Harnss-0.12.1-arm64-mac.zip",
      "Harnss-0.11.0-arm64-mac.zip",
    ]);

    const result = findUpdateZip();
    expect(result).toBe(`${cacheDir}/Harnss-0.12.1-arm64-mac.zip`);
  });

  it("falls back to newest ZIP when no version match", () => {
    (fs.existsSync as Mock).mockReturnValue(true);
    (fs.readdirSync as Mock).mockReturnValue([
      "Harnss-0.11.0-arm64-mac.zip",
      "Harnss-0.10.0-arm64-mac.zip",
    ]);
    (fs.statSync as Mock).mockImplementation((p: string) => ({
      mtimeMs: (p as string).includes("0.11.0") ? 2000 : 1000,
    }));

    const result = findUpdateZip();
    expect(result).toBe(`${cacheDir}/Harnss-0.11.0-arm64-mac.zip`);
  });

  it("ignores temp-prefixed files in fallback", () => {
    (fs.existsSync as Mock).mockReturnValue(true);
    (fs.readdirSync as Mock).mockReturnValue([
      "temp-Harnss-0.12.1-arm64-mac.zip",
      "Harnss-0.11.0-arm64-mac.zip",
    ]);
    (fs.statSync as Mock).mockReturnValue({ mtimeMs: 1000 });

    const result = findUpdateZip();
    expect(result).toBe(`${cacheDir}/Harnss-0.11.0-arm64-mac.zip`);
  });

  it("ignores non-mac.zip files", () => {
    (fs.existsSync as Mock).mockReturnValue(true);
    (fs.readdirSync as Mock).mockReturnValue(["Harnss-Setup-0.12.1-x64.exe"]);

    expect(findUpdateZip()).toBeNull();
  });

  it("returns null when cache dir exists but has no matching ZIPs", () => {
    (fs.existsSync as Mock).mockReturnValue(true);
    (fs.readdirSync as Mock).mockReturnValue([]);

    expect(findUpdateZip()).toBeNull();
  });
});

describe("checkForUpdates", () => {
  it("calls autoUpdater.checkForUpdates()", async () => {
    await checkForUpdates("test");
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledOnce();
  });

  it("logs the reason string", async () => {
    await checkForUpdates("manual");
    expect(log).toHaveBeenCalledWith("UPDATER_DEBUG", expect.stringContaining("manual"));
  });

  it("prevents concurrent checks", async () => {
    // Make first check hang
    let resolveCheck!: () => void;
    mockAutoUpdater.checkForUpdates.mockReturnValue(
      new Promise<void>((r) => {
        resolveCheck = r;
      }),
    );

    const first = checkForUpdates("first");
    const second = checkForUpdates("second");

    resolveCheck();
    await first;
    await second;

    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("UPDATER_DEBUG", expect.stringContaining("Skipping"));
  });

  it("resets flight flag after completion allowing subsequent checks", async () => {
    await checkForUpdates("first");
    await checkForUpdates("second");
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("catches and logs errors without throwing", async () => {
    mockAutoUpdater.checkForUpdates.mockRejectedValueOnce(new Error("network"));
    // Should not throw
    await checkForUpdates("failing");
    expect(log).toHaveBeenCalledWith("UPDATER_ERR", expect.stringContaining("network"));
  });
});

describe("maybeCheckForUpdates", () => {
  it("calls checkForUpdates when enough time has elapsed", async () => {
    // lastUpdateCheckAt is 0 after reset, advance system time so elapsed > interval
    vi.setSystemTime(Date.now() + 60_000);
    maybeCheckForUpdates("test", 30_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledOnce();
  });

  it("skips check when interval has not elapsed", async () => {
    // Do a check to set lastUpdateCheckAt
    await checkForUpdates("setup");
    mockAutoUpdater.checkForUpdates.mockClear();

    // Try again immediately — should be skipped
    maybeCheckForUpdates("too-soon", 30 * 60 * 1_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });
});

describe("initAutoUpdater", () => {
  describe("initialization", () => {
    it("returns early when app.isPackaged is false", () => {
      mockApp.isPackaged = false;
      init();
      expect(mockIpcHandlers.size).toBe(0);
      mockApp.isPackaged = true;
    });

    it("configures autoUpdater properties", () => {
      init();
      expect(mockAutoUpdater.autoDownload).toBe(false);
      expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true);
      expect(mockAutoUpdater.allowPrerelease).toBe(true); // from mocked getAppSetting
      expect(mockAutoUpdater.allowDowngrade).toBe(false);
    });

    it("sets up custom logger on autoUpdater", () => {
      init();
      expect(mockAutoUpdater.logger).toBeDefined();
      const logger = mockAutoUpdater.logger as {
        info: (...args: unknown[]) => void;
        warn: (...args: unknown[]) => void;
        error: (...args: unknown[]) => void;
        debug: (...args: unknown[]) => void;
      };
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.warn).toBe("function");
      expect(typeof logger.error).toBe("function");
      expect(typeof logger.debug).toBe("function");
    });

    it("registers all expected IPC handlers", () => {
      init();
      expect(mockIpcHandlers.has("updater:download")).toBe(true);
      expect(mockIpcHandlers.has("updater:install")).toBe(true);
      expect(mockIpcHandlers.has("updater:check")).toBe(true);
      expect(mockIpcHandlers.has("updater:current-version")).toBe(true);
    });

    it("subscribes to settings changes", () => {
      init();
      expect(settingsChangedCbRef.current).not.toBeNull();

      // Simulate a settings change
      settingsChangedCbRef.current!({ allowPrereleaseUpdates: false });
      expect(mockAutoUpdater.allowPrerelease).toBe(false);
      expect(mockAutoUpdater.allowDowngrade).toBe(false);
    });

    it("allows downgrade when a prerelease build switches to stable-only updates", () => {
      mockApp.getVersion.mockReturnValue("0.12.0-beta.1");

      init();

      expect(mockAutoUpdater.allowPrerelease).toBe(true);
      expect(mockAutoUpdater.allowDowngrade).toBe(false);

      settingsChangedCbRef.current!({ allowPrereleaseUpdates: false });

      expect(mockAutoUpdater.allowPrerelease).toBe(false);
      expect(mockAutoUpdater.allowDowngrade).toBe(true);
      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledWith();
    });

    it("enables downgrade on startup when a prerelease build is already in stable-only mode", () => {
      mockApp.getVersion.mockReturnValue("0.12.0-beta.1");
      (getAppSetting as Mock).mockReturnValue(false);

      init();

      expect(mockAutoUpdater.allowPrerelease).toBe(false);
      expect(mockAutoUpdater.allowDowngrade).toBe(true);
    });

    it("schedules startup update check after 5s", async () => {
      init();
      expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(STARTUP_UPDATE_CHECK_DELAY_MS);
      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledOnce();
    });

    it("schedules periodic update check every 4 hours", async () => {
      init();

      // First: startup check at 5s
      await vi.advanceTimersByTimeAsync(STARTUP_UPDATE_CHECK_DELAY_MS);
      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

      // Advance to first periodic check
      await vi.advanceTimersByTimeAsync(PERIODIC_UPDATE_CHECK_INTERVAL_MS);
      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
    });

    it("registers powerMonitor resume listener", () => {
      init();
      expect(powerMonitor.on).toHaveBeenCalledWith("resume", expect.any(Function));
    });

    it("registers browser-window-focus listener", () => {
      init();
      expect(app.on).toHaveBeenCalledWith("browser-window-focus", expect.any(Function));
    });
  });

  describe("event forwarding to renderer", () => {
    it("forwards update-available to renderer", () => {
      init();
      mockAutoUpdater.emit("update-available", {
        version: "1.0.0",
        releaseNotes: "notes",
      });

      expect(mockWebContents.send).toHaveBeenCalledWith("updater:update-available", {
        version: "1.0.0",
        releaseNotes: "notes",
      });
    });

    it("forwards download-progress to renderer", () => {
      init();
      mockAutoUpdater.emit("download-progress", {
        percent: 50,
        bytesPerSecond: 1024,
        total: 2048,
        transferred: 1024,
      });

      expect(mockWebContents.send).toHaveBeenCalledWith("updater:download-progress", {
        percent: 50,
        bytesPerSecond: 1024,
        total: 2048,
        transferred: 1024,
      });
    });

    it("forwards update-downloaded to renderer", () => {
      init();
      mockAutoUpdater.emit("update-downloaded", { version: "1.0.0" });

      expect(mockWebContents.send).toHaveBeenCalledWith("updater:update-downloaded", {
        version: "1.0.0",
      });
    });

    it("does not crash when no main window exists", () => {
      initAutoUpdater(() => null);
      // Should not throw
      mockAutoUpdater.emit("update-available", { version: "1.0.0" });
      mockAutoUpdater.emit("download-progress", { percent: 50 });
      mockAutoUpdater.emit("update-downloaded", { version: "1.0.0" });
    });
  });

  describe("updater:install handler — Windows/Linux", () => {
    beforeEach(() => {
      setPlatform("win32");
      init();
    });

    it("calls quitAndInstall when update has been downloaded", async () => {
      // Simulate a completed download
      mockAutoUpdater.emit("update-downloaded", { version: "0.12.1" });

      await getHandler("updater:install")();
      // quitAndInstall is deferred via setImmediate
      await vi.advanceTimersByTimeAsync(0);

      expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledOnce();
      expect(getIsInstallingUpdate()).toBe(true);
      expect(mockWindow.destroy).toHaveBeenCalled();
    });

    it("sends install-error when no update has been downloaded", async () => {
      // No update-downloaded event emitted — lastDownloadedVersion is null
      await getHandler("updater:install")();

      expect(mockWebContents.send).toHaveBeenCalledWith(
        "updater:install-error",
        expect.objectContaining({
          message: expect.stringContaining("failed to download"),
        }),
      );
      expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled();
    });

    it("does not check squirrelDownloadedUpdate on Windows", async () => {
      // squirrelDownloadedUpdate is undefined (as it would be on real Windows)
      mockAutoUpdater.squirrelDownloadedUpdate = undefined;
      mockAutoUpdater.emit("update-downloaded", { version: "0.12.1" });

      await getHandler("updater:install")();
      await vi.advanceTimersByTimeAsync(0);

      // Should succeed regardless — this is the bug we fixed
      expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledOnce();
    });

    it("works on Linux too", async () => {
      setPlatform("linux");

      mockAutoUpdater.emit("update-downloaded", { version: "0.12.1" });

      await getHandler("updater:install")();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledOnce();
    });
  });

  describe("updater:install handler — macOS", () => {
    beforeEach(() => {
      setPlatform("darwin");
      init();
    });

    it("calls quitAndInstall when squirrelDownloadedUpdate is true", async () => {
      mockAutoUpdater.squirrelDownloadedUpdate = true;

      await getHandler("updater:install")();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledOnce();
      expect(getIsInstallingUpdate()).toBe(true);
      expect(mockWindow.destroy).toHaveBeenCalled();
    });

    it("falls back to manualMacInstall when squirrelDownloadedUpdate is false", async () => {
      mockAutoUpdater.squirrelDownloadedUpdate = false;

      // Mock the filesystem for manualMacInstall
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readdirSync as Mock)
        // First call: findUpdateZip cache dir
        .mockReturnValueOnce(["Harnss-0.12.1-arm64-mac.zip"])
        // Second call: extracted tmpDir contents
        .mockReturnValueOnce(["Harnss.app"]);
      (fs.statSync as Mock).mockReturnValue({ mtimeMs: 1000 });

      // Simulate download to set lastDownloadedVersion
      mockAutoUpdater.emit("update-downloaded", { version: "0.12.1" });

      await getHandler("updater:install")();

      // manualMacInstall should relaunch the app
      expect(app.relaunch).toHaveBeenCalled();
      expect(app.exit).toHaveBeenCalledWith(0);
    });

    it("opens GitHub release page when manualMacInstall fails", async () => {
      mockAutoUpdater.squirrelDownloadedUpdate = false;
      // findUpdateZip returns null → manualMacInstall throws
      (fs.existsSync as Mock).mockReturnValue(false);

      // Set lastDownloadedVersion for version-specific URL
      mockAutoUpdater.emit("update-downloaded", { version: "0.12.1" });

      await getHandler("updater:install")();

      expect(shell.openExternal).toHaveBeenCalledWith(
        "https://github.com/OpenSource03/harnss/releases/tag/v0.12.1",
      );
      expect(mockWebContents.send).toHaveBeenCalledWith(
        "updater:install-error",
        expect.objectContaining({
          message: expect.stringContaining("install manually"),
        }),
      );
    });

    it("uses latest release URL when lastDownloadedVersion is null", async () => {
      mockAutoUpdater.squirrelDownloadedUpdate = false;
      (fs.existsSync as Mock).mockReturnValue(false);
      // Don't emit update-downloaded — lastDownloadedVersion stays null

      await getHandler("updater:install")();

      expect(shell.openExternal).toHaveBeenCalledWith(
        "https://github.com/OpenSource03/harnss/releases/latest",
      );
    });
  });

  describe("updater:install handler — manualMacInstall flow", () => {
    beforeEach(() => {
      setPlatform("darwin");
      init();
      mockAutoUpdater.squirrelDownloadedUpdate = false;
    });

    it("completes the full happy path: extract, swap, relaunch", async () => {
      const calls: string[] = [];

      // Track fs operation order
      (fs.existsSync as Mock).mockImplementation((p: string) => {
        if (p.includes("pending")) return true; // cache dir exists
        if (p.includes(".old")) return false; // no stale backup
        return false;
      });
      (fs.readdirSync as Mock)
        .mockReturnValueOnce(["Harnss-0.12.1-arm64-mac.zip"]) // findUpdateZip
        .mockReturnValueOnce(["Harnss.app"]); // extracted dir
      (fs.statSync as Mock).mockReturnValue({ mtimeMs: 1000 });
      (fs.mkdirSync as Mock).mockImplementation(() => calls.push("mkdirSync"));
      (fs.renameSync as Mock).mockImplementation(() => calls.push("renameSync"));
      (fs.rmSync as Mock).mockImplementation(() => calls.push("rmSync"));

      mockAutoUpdater.emit("update-downloaded", { version: "0.12.1" });
      await getHandler("updater:install")();

      // Verify the operation sequence
      expect(calls).toContain("mkdirSync"); // create tmp dir
      expect(calls).toContain("renameSync"); // backup old .app
      expect(calls).toContain("rmSync"); // cleanup

      // Verify relaunch
      expect(app.relaunch).toHaveBeenCalled();
      expect(app.exit).toHaveBeenCalledWith(0);
      expect(getIsInstallingUpdate()).toBe(true);
    });

    it("rolls back on copy failure", async () => {
      (fs.existsSync as Mock).mockImplementation((p: string) => {
        if (p.includes("pending")) return true;
        if (p.includes(".old")) return false;
        return false;
      });
      (fs.readdirSync as Mock)
        .mockReturnValueOnce(["Harnss-0.12.1-arm64-mac.zip"])
        .mockReturnValueOnce(["Harnss.app"]);
      (fs.statSync as Mock).mockReturnValue({ mtimeMs: 1000 });

      // Make the second ditto call (copy) fail
      let dittoCallCount = 0;
      (execFile as unknown as Mock).mockImplementation(
        (
          cmd: string,
          _args: string[],
          cb: (err: Error | null, stdout: string, stderr: string) => void,
        ) => {
          if (cmd === "ditto") {
            dittoCallCount++;
            // First ditto = extract (ok), second ditto = copy (fail)
            if (dittoCallCount >= 2) {
              cb(new Error("copy failed"), "", "");
              return;
            }
          }
          cb(null, "", "");
        },
      );

      mockAutoUpdater.emit("update-downloaded", { version: "0.12.1" });
      await getHandler("updater:install")();

      // Should have rolled back (renameSync called to restore backup)
      expect(fs.renameSync).toHaveBeenCalled();
      // Should have opened the release page as last resort
      expect(shell.openExternal).toHaveBeenCalled();
    });

    it("cleans up tmpDir on any failure", async () => {
      (fs.existsSync as Mock).mockReturnValue(false); // no cache dir → findUpdateZip returns null

      mockAutoUpdater.emit("update-downloaded", { version: "0.12.1" });
      await getHandler("updater:install")();

      // The error is caught, and GitHub release page is opened
      expect(shell.openExternal).toHaveBeenCalled();
    });

    it("continues when xattr stripping fails (non-fatal)", async () => {
      (fs.existsSync as Mock).mockImplementation((p: string) => {
        if (p.includes("pending")) return true;
        if (p.includes(".old")) return false;
        return false;
      });
      (fs.readdirSync as Mock)
        .mockReturnValueOnce(["Harnss-0.12.1-arm64-mac.zip"])
        .mockReturnValueOnce(["Harnss.app"]);
      (fs.statSync as Mock).mockReturnValue({ mtimeMs: 1000 });

      // Make xattr fail but ditto succeed
      (execFile as unknown as Mock).mockImplementation(
        (
          cmd: string,
          _args: string[],
          cb: (err: Error | null, stdout: string, stderr: string) => void,
        ) => {
          if (cmd === "xattr") {
            cb(new Error("xattr not found"), "", "");
          } else {
            cb(null, "", "");
          }
        },
      );

      mockAutoUpdater.emit("update-downloaded", { version: "0.12.1" });
      await getHandler("updater:install")();

      // Install should still succeed despite xattr failure
      expect(app.relaunch).toHaveBeenCalled();
      expect(app.exit).toHaveBeenCalledWith(0);
    });

    it("throws when exe path does not match .app pattern", async () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readdirSync as Mock).mockReturnValueOnce(["Harnss-0.12.1-arm64-mac.zip"]);
      (fs.statSync as Mock).mockReturnValue({ mtimeMs: 1000 });

      // Return an exe path without .app bundle pattern
      mockApp.getPath.mockImplementation((name: string) => {
        if (name === "exe") return "/usr/local/bin/harnss";
        if (name === "appData") return "/mock/Library/Application Support";
        if (name === "temp") return "/tmp";
        return "/mock";
      });

      mockAutoUpdater.emit("update-downloaded", { version: "0.12.1" });
      await getHandler("updater:install")();

      // Should fall through to error handler → open release page
      expect(shell.openExternal).toHaveBeenCalled();

      // Restore normal exe path for other tests
      mockApp.getPath.mockImplementation((name: string) => {
        const paths: Record<string, string> = {
          appData: "/mock/Library/Application Support",
          exe: "/Applications/Harnss.app/Contents/MacOS/Harnss",
          temp: "/tmp",
        };
        return paths[name] ?? "/mock";
      });
    });

    it("throws when no write permission to app parent directory", async () => {
      (fs.existsSync as Mock).mockImplementation((p: string) => {
        if (p.includes("pending")) return true;
        return false;
      });
      (fs.readdirSync as Mock).mockReturnValueOnce(["Harnss-0.12.1-arm64-mac.zip"]);
      (fs.statSync as Mock).mockReturnValue({ mtimeMs: 1000 });
      (fs.accessSync as Mock).mockImplementation(() => {
        throw new Error("EACCES");
      });

      mockAutoUpdater.emit("update-downloaded", { version: "0.12.1" });
      await getHandler("updater:install")();

      expect(shell.openExternal).toHaveBeenCalled();
      expect(mockWebContents.send).toHaveBeenCalledWith(
        "updater:install-error",
        expect.objectContaining({
          message: expect.stringContaining("install manually"),
        }),
      );
    });
  });

  describe("getIsInstallingUpdate", () => {
    it("returns false initially", () => {
      expect(getIsInstallingUpdate()).toBe(false);
    });

    it("returns true after install starts on Windows", async () => {
      setPlatform("win32");
      init();
      mockAutoUpdater.emit("update-downloaded", { version: "0.12.1" });

      await getHandler("updater:install")();

      expect(getIsInstallingUpdate()).toBe(true);
    });
  });

  describe("updater:current-version handler", () => {
    it("returns app.getVersion()", () => {
      init();
      const result = getHandler("updater:current-version")();
      expect(result).toBe("0.12.0");
    });
  });

  describe("updater:check handler", () => {
    it("triggers an update check", async () => {
      init();
      await getHandler("updater:check")();
      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalled();
    });
  });
});

describe("exported constants", () => {
  it("has correct timing values", () => {
    expect(STARTUP_UPDATE_CHECK_DELAY_MS).toBe(5_000);
    expect(PERIODIC_UPDATE_CHECK_INTERVAL_MS).toBe(4 * 60 * 60 * 1_000);
    expect(ACTIVE_UPDATE_CHECK_MIN_INTERVAL_MS).toBe(30 * 60 * 1_000);
  });
});
