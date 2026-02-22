import { execSync } from "child_process";
import { app, BrowserWindow, globalShortcut } from "electron";
import path from "path";
import http from "http";

// Packaged .app bundles launched from Finder get a minimal PATH (/usr/bin:/bin).
// Inherit the user's shell PATH so child processes (SDK's `node`, git, etc.) resolve.
if (process.platform !== "win32") {
  try {
    const shell = process.env.SHELL || "/bin/zsh";
    const shellPath = execSync(`${shell} -ilc 'echo -n "$PATH"'`, {
      encoding: "utf8",
      timeout: 5000,
    });
    if (shellPath) process.env.PATH = shellPath;
  } catch {
    // Fall through — keep whatever PATH we already have
  }
}
import { log } from "./lib/logger";
import { glassEnabled, liquidGlass } from "./lib/glass";
import { initAutoUpdater, getIsInstallingUpdate } from "./lib/updater";
import { sessions } from "./ipc/claude-sessions";
import { acpSessions } from "./ipc/acp-sessions";
import { terminals } from "./ipc/terminal";

// IPC module registrations
import * as spacesIpc from "./ipc/spaces";
import * as projectsIpc from "./ipc/projects";
import * as sessionsIpc from "./ipc/sessions";
import * as ccImportIpc from "./ipc/cc-import";
import * as filesIpc from "./ipc/files";
import * as claudeSessionsIpc from "./ipc/claude-sessions";
import * as titleGenIpc from "./ipc/title-gen";
import * as terminalIpc from "./ipc/terminal";
import * as gitIpc from "./ipc/git";
import * as agentRegistryIpc from "./ipc/agent-registry";
import * as acpSessionsIpc from "./ipc/acp-sessions";
import * as mcpIpc from "./ipc/mcp";
import { ipcMain } from "electron";

// --- Performance: Chromium/V8 flags (must be set before app.whenReady()) ---
app.commandLine.appendSwitch("enable-gpu-rasterization"); // force GPU raster for all content
app.commandLine.appendSwitch("enable-zero-copy"); // avoid CPU→GPU memory copies for tiles
app.commandLine.appendSwitch("ignore-gpu-blocklist"); // use GPU even on blocklisted hardware
app.commandLine.appendSwitch("enable-features", "CanvasOopRasterization"); // off-main-thread canvas

// --- Liquid Glass command-line switches ---
if (glassEnabled) {
  app.commandLine.appendSwitch("remote-debugging-port", "9222");
  app.commandLine.appendSwitch("remote-allow-origins", "*");
}

let mainWindow: BrowserWindow | null = null;

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function createWindow(): void {
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1200,
    height: 800,
    minWidth: 1280,
    minHeight: 600,
    // build/ isn't in the asar (buildResources only); use dist/ (Vite output) in production
    icon: app.isPackaged
      ? path.join(__dirname, "../../dist/icon.png")
      : path.join(__dirname, "../../build/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      devTools: !glassEnabled,
      v8CacheOptions: "bypassHeatCheckAndEagerCompile", // cache compiled JS on first run — eliminates cold-start jank
    },
  };

  if (glassEnabled) {
    // macOS Tahoe+ with liquid glass
    windowOptions.titleBarStyle = "hidden";
    windowOptions.transparent = true;
    windowOptions.trafficLightPosition = { x: 16, y: 16 };
  } else if (process.platform === "win32") {
    // Windows: native Electron backgroundMaterial handles DWM mica/acrylic.
    // WebContents is automatically transparent (no transparent: true needed),
    // and the native title bar stays intact.
    windowOptions.autoHideMenuBar = true;
    windowOptions.backgroundMaterial = "mica";
  } else {
    // macOS without glass / Linux
    windowOptions.titleBarStyle = "hiddenInset";
    windowOptions.trafficLightPosition = { x: 16, y: 16 };
    windowOptions.backgroundColor = "#18181b";
  }

  mainWindow = new BrowserWindow(windowOptions);

  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  if (glassEnabled) {
    // macOS: apply liquid glass after content loads
    mainWindow.webContents.once("did-finish-load", () => {
      const glassId = liquidGlass!.addView(mainWindow!.getNativeWindowHandle(), {});
      if (glassId === -1) {
        log("GLASS", "addView returned -1 — native addon failed, glass will not be visible");
      } else {
        log("GLASS", `Liquid glass applied, viewId=${glassId}`);
      }
    });
  }
}

// Renderer uses this to set `glass-enabled` CSS class → transparent backgrounds for both platforms
ipcMain.handle("app:getGlassEnabled", () => {
  return !!(glassEnabled || process.platform === "win32");
});

// --- Register all IPC modules ---
spacesIpc.register();
projectsIpc.register(getMainWindow);
sessionsIpc.register();
ccImportIpc.register();
filesIpc.register();
claudeSessionsIpc.register(getMainWindow);
titleGenIpc.register();
terminalIpc.register(getMainWindow);
gitIpc.register();
agentRegistryIpc.register();
acpSessionsIpc.register(getMainWindow);
mcpIpc.register();

// --- DevTools in separate window via remote debugging ---
let devToolsWindow: BrowserWindow | null = null;

function openDevToolsWindow(): void {
  if (!glassEnabled) {
    mainWindow?.webContents.openDevTools({ mode: "detach" });
    return;
  }

  if (devToolsWindow && !devToolsWindow.isDestroyed()) {
    devToolsWindow.focus();
    return;
  }

  http.get("http://127.0.0.1:9222/json", (res) => {
    let body = "";
    res.on("data", (chunk: Buffer) => { body += chunk; });
    res.on("end", () => {
      try {
        const targets = JSON.parse(body) as Array<{ type: string; webSocketDebuggerUrl?: string }>;
        const page = targets.find((t) => t.type === "page");
        if (!page) {
          log("DEVTOOLS", "No debuggable page target found");
          return;
        }

        const wsUrl = page.webSocketDebuggerUrl;
        if (!wsUrl) {
          log("DEVTOOLS", "No webSocketDebuggerUrl in target");
          return;
        }

        const wsParam = encodeURIComponent(wsUrl.replace("ws://", ""));
        const fullUrl = `devtools://devtools/bundled/inspector.html?ws=${wsParam}`;

        devToolsWindow = new BrowserWindow({
          width: 1000,
          height: 700,
          title: "OpenACP UI DevTools",
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
          },
        });

        devToolsWindow.loadURL(fullUrl);
        devToolsWindow.on("closed", () => {
          devToolsWindow = null;
        });

        log("DEVTOOLS", `Opened DevTools window: ${fullUrl}`);
      } catch (err) {
        log("DEVTOOLS_ERR", `Failed to parse targets: ${(err as Error).message}`);
      }
    });
  }).on("error", (err) => {
    log("DEVTOOLS_ERR", `Remote debugging not available: ${err.message}`);
  });
}

// --- App lifecycle ---
app.whenReady().then(() => {
  createWindow();
  initAutoUpdater(getMainWindow);

  // Set dock icon in dev mode — packaged builds get it from the .app bundle
  if (process.platform === "darwin" && app.dock) {
    const dockIcon = app.isPackaged
      ? path.join(__dirname, "../../dist/icon.png")
      : path.join(__dirname, "../../build/icon.png");
    app.dock.setIcon(dockIcon);
  }

  const shortcuts = ["CommandOrControl+Alt+I", "F12", "CommandOrControl+Shift+J"];
  for (const shortcut of shortcuts) {
    const ok = globalShortcut.register(shortcut, () => {
      log("DEVTOOLS", `Shortcut ${shortcut} triggered`);
      openDevToolsWindow();
    });
    log("DEVTOOLS", `Register ${shortcut}: ${ok ? "OK" : "FAILED"}`);
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  for (const [sessionId, session] of sessions) {
    log("CLEANUP", `Closing session ${sessionId.slice(0, 8)}`);
    // Mark as stopping so event loops suppress expected teardown errors
    session.stopping = true;
    session.channel.close();
    session.queryHandle?.close();
  }
  sessions.clear();

  for (const [sessionId, entry] of acpSessions) {
    log("CLEANUP", `Stopping ACP session ${sessionId.slice(0, 8)}`);
    entry.process?.kill();
  }
  acpSessions.clear();

  for (const [terminalId, term] of terminals) {
    log("CLEANUP", `Killing terminal ${terminalId.slice(0, 8)}`);
    term.pty.kill();
  }
  terminals.clear();

  // When quitAndInstall() is running, Squirrel.Mac needs to control the quit lifecycle.
  // Calling app.quit() here would kill the process before the update is applied on macOS.
  if (!getIsInstallingUpdate()) {
    app.quit();
  }
});
