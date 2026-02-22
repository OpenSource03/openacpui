import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

// Apply platform + glass classes as early as possible (before React mounts)
ipcRenderer.invoke("app:getGlassEnabled").then((enabled: boolean) => {
  // Platform class for platform-specific CSS (e.g. hiding macOS traffic-light padding on Windows)
  document.documentElement.classList.add(`platform-${process.platform}`);
  if (enabled) {
    document.documentElement.classList.add("glass-enabled");
  }
});

contextBridge.exposeInMainWorld("claude", {
  getGlassEnabled: () => ipcRenderer.invoke("app:getGlassEnabled"),
  start: (options: unknown) => ipcRenderer.invoke("claude:start", options),
  send: (sessionId: string, message: unknown) => ipcRenderer.invoke("claude:send", { sessionId, message }),
  stop: (sessionId: string) => ipcRenderer.invoke("claude:stop", sessionId),
  interrupt: (sessionId: string) => ipcRenderer.invoke("claude:interrupt", sessionId),
  log: (label: string, data: unknown) => ipcRenderer.send("claude:log", label, data),
  onEvent: (callback: (data: unknown) => void) => {
    const listener = (_event: IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("claude:event", listener);
    return () => ipcRenderer.removeListener("claude:event", listener);
  },
  onStderr: (callback: (data: unknown) => void) => {
    const listener = (_event: IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("claude:stderr", listener);
    return () => ipcRenderer.removeListener("claude:stderr", listener);
  },
  onExit: (callback: (data: unknown) => void) => {
    const listener = (_event: IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("claude:exit", listener);
    return () => ipcRenderer.removeListener("claude:exit", listener);
  },
  onPermissionRequest: (callback: (data: unknown) => void) => {
    const listener = (_event: IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("claude:permission_request", listener);
    return () => ipcRenderer.removeListener("claude:permission_request", listener);
  },
  respondPermission: (sessionId: string, requestId: string, behavior: string, toolUseId: string, toolInput: unknown, newPermissionMode?: string) =>
    ipcRenderer.invoke("claude:permission_response", { sessionId, requestId, behavior, toolUseId, toolInput, newPermissionMode }),
  setPermissionMode: (sessionId: string, permissionMode: string) =>
    ipcRenderer.invoke("claude:set-permission-mode", { sessionId, permissionMode }),
  supportedModels: (sessionId: string) => ipcRenderer.invoke("claude:supported-models", sessionId),
  mcpStatus: (sessionId: string) => ipcRenderer.invoke("claude:mcp-status", sessionId),
  mcpReconnect: (sessionId: string, serverName: string) =>
    ipcRenderer.invoke("claude:mcp-reconnect", { sessionId, serverName }),
  restartSession: (sessionId: string, mcpServers?: unknown[]) =>
    ipcRenderer.invoke("claude:restart-session", { sessionId, mcpServers }),
  readFile: (filePath: string) => ipcRenderer.invoke("file:read", filePath),
  openInEditor: (filePath: string, line?: number) => ipcRenderer.invoke("file:open-in-editor", { filePath, line }),
  generateTitle: (message: string, cwd?: string) => ipcRenderer.invoke("claude:generate-title", { message, cwd }),
  projects: {
    list: () => ipcRenderer.invoke("projects:list"),
    create: () => ipcRenderer.invoke("projects:create"),
    delete: (projectId: string) => ipcRenderer.invoke("projects:delete", projectId),
    rename: (projectId: string, name: string) => ipcRenderer.invoke("projects:rename", projectId, name),
    updateSpace: (projectId: string, spaceId: string) => ipcRenderer.invoke("projects:update-space", projectId, spaceId),
    reorder: (projectId: string, targetProjectId: string) => ipcRenderer.invoke("projects:reorder", projectId, targetProjectId),
  },
  sessions: {
    save: (data: unknown) => ipcRenderer.invoke("sessions:save", data),
    load: (projectId: string, sessionId: string) => ipcRenderer.invoke("sessions:load", projectId, sessionId),
    list: (projectId: string) => ipcRenderer.invoke("sessions:list", projectId),
    delete: (projectId: string, sessionId: string) => ipcRenderer.invoke("sessions:delete", projectId, sessionId),
    search: (projectIds: string[], query: string) => ipcRenderer.invoke("sessions:search", { projectIds, query }),
  },
  spaces: {
    list: () => ipcRenderer.invoke("spaces:list"),
    save: (spaces: unknown) => ipcRenderer.invoke("spaces:save", spaces),
  },
  ccSessions: {
    list: (projectPath: string) => ipcRenderer.invoke("cc-sessions:list", projectPath),
    import: (projectPath: string, ccSessionId: string) => ipcRenderer.invoke("cc-sessions:import", projectPath, ccSessionId),
  },
  files: {
    list: (cwd: string) => ipcRenderer.invoke("files:list", cwd),
    readMultiple: (cwd: string, paths: string[]) => ipcRenderer.invoke("files:read-multiple", { cwd, paths }),
  },
  git: {
    discoverRepos: (projectPath: string) => ipcRenderer.invoke("git:discover-repos", projectPath),
    status: (cwd: string) => ipcRenderer.invoke("git:status", cwd),
    stage: (cwd: string, files: string[]) => ipcRenderer.invoke("git:stage", { cwd, files }),
    unstage: (cwd: string, files: string[]) => ipcRenderer.invoke("git:unstage", { cwd, files }),
    stageAll: (cwd: string) => ipcRenderer.invoke("git:stage-all", cwd),
    unstageAll: (cwd: string) => ipcRenderer.invoke("git:unstage-all", cwd),
    discard: (cwd: string, files: string[]) => ipcRenderer.invoke("git:discard", { cwd, files }),
    commit: (cwd: string, message: string) => ipcRenderer.invoke("git:commit", { cwd, message }),
    branches: (cwd: string) => ipcRenderer.invoke("git:branches", cwd),
    checkout: (cwd: string, branch: string) => ipcRenderer.invoke("git:checkout", { cwd, branch }),
    createBranch: (cwd: string, name: string) => ipcRenderer.invoke("git:create-branch", { cwd, name }),
    push: (cwd: string) => ipcRenderer.invoke("git:push", cwd),
    pull: (cwd: string) => ipcRenderer.invoke("git:pull", cwd),
    fetch: (cwd: string) => ipcRenderer.invoke("git:fetch", cwd),
    diffFile: (cwd: string, file: string, staged: boolean) => ipcRenderer.invoke("git:diff-file", { cwd, file, staged }),
    log: (cwd: string, count?: number) => ipcRenderer.invoke("git:log", { cwd, count }),
    generateCommitMessage: (cwd: string) => ipcRenderer.invoke("git:generate-commit-message", { cwd }),
  },
  terminal: {
    create: (options: unknown) => ipcRenderer.invoke("terminal:create", options),
    write: (terminalId: string, data: string) => ipcRenderer.invoke("terminal:write", { terminalId, data }),
    resize: (terminalId: string, cols: number, rows: number) => ipcRenderer.invoke("terminal:resize", { terminalId, cols, rows }),
    destroy: (terminalId: string) => ipcRenderer.invoke("terminal:destroy", terminalId),
    onData: (callback: (data: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("terminal:data", listener);
      return () => ipcRenderer.removeListener("terminal:data", listener);
    },
    onExit: (callback: (data: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("terminal:exit", listener);
      return () => ipcRenderer.removeListener("terminal:exit", listener);
    },
  },
  acp: {
    log: (label: string, data: unknown) => ipcRenderer.send("acp:log", label, data),
    start: (options: { agentId: string; cwd: string; mcpServers?: unknown[] }) => ipcRenderer.invoke("acp:start", options),
    prompt: (sessionId: string, text: string, images?: unknown[]) =>
      ipcRenderer.invoke("acp:prompt", { sessionId, text, images }),
    stop: (sessionId: string) => ipcRenderer.invoke("acp:stop", sessionId),
    reloadSession: (sessionId: string, mcpServers?: unknown[]) =>
      ipcRenderer.invoke("acp:reload-session", { sessionId, mcpServers }),
    reviveSession: (options: { agentId: string; cwd: string; agentSessionId?: string; mcpServers?: unknown[] }) =>
      ipcRenderer.invoke("acp:revive-session", options),
    cancel: (sessionId: string) => ipcRenderer.invoke("acp:cancel", sessionId),
    respondPermission: (sessionId: string, requestId: string, optionId: string) =>
      ipcRenderer.invoke("acp:permission_response", { sessionId, requestId, optionId }),
    setConfig: (sessionId: string, configId: string, value: string) =>
      ipcRenderer.invoke("acp:set-config", { sessionId, configId, value }),
    getConfigOptions: (sessionId: string) =>
      ipcRenderer.invoke("acp:get-config-options", sessionId),
    onEvent: (callback: (data: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("acp:event", listener);
      return () => ipcRenderer.removeListener("acp:event", listener);
    },
    onPermissionRequest: (callback: (data: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("acp:permission_request", listener);
      return () => ipcRenderer.removeListener("acp:permission_request", listener);
    },
    onTurnComplete: (callback: (data: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("acp:turn_complete", listener);
      return () => ipcRenderer.removeListener("acp:turn_complete", listener);
    },
    onExit: (callback: (data: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("acp:exit", listener);
      return () => ipcRenderer.removeListener("acp:exit", listener);
    },
  },
  mcp: {
    list: (projectId: string) => ipcRenderer.invoke("mcp:list", projectId),
    add: (projectId: string, server: unknown) => ipcRenderer.invoke("mcp:add", { projectId, server }),
    remove: (projectId: string, name: string) => ipcRenderer.invoke("mcp:remove", { projectId, name }),
    authenticate: (serverName: string, serverUrl: string) => ipcRenderer.invoke("mcp:authenticate", { serverName, serverUrl }),
    authStatus: (serverName: string) => ipcRenderer.invoke("mcp:auth-status", serverName),
    probe: (servers: unknown[]) => ipcRenderer.invoke("mcp:probe", servers),
  },
  agents: {
    list: () => ipcRenderer.invoke("agents:list"),
    save: (agent: unknown) => ipcRenderer.invoke("agents:save", agent),
    delete: (id: string) => ipcRenderer.invoke("agents:delete", id),
  },
  updater: {
    onUpdateAvailable: (cb: (info: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, info: unknown) => cb(info);
      ipcRenderer.on("updater:update-available", listener);
      return () => ipcRenderer.removeListener("updater:update-available", listener);
    },
    onDownloadProgress: (cb: (progress: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, progress: unknown) => cb(progress);
      ipcRenderer.on("updater:download-progress", listener);
      return () => ipcRenderer.removeListener("updater:download-progress", listener);
    },
    onUpdateDownloaded: (cb: (info: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, info: unknown) => cb(info);
      ipcRenderer.on("updater:update-downloaded", listener);
      return () => ipcRenderer.removeListener("updater:update-downloaded", listener);
    },
    download: () => ipcRenderer.invoke("updater:download"),
    install: () => ipcRenderer.invoke("updater:install"),
    check: () => ipcRenderer.invoke("updater:check"),
    currentVersion: () => ipcRenderer.invoke("updater:current-version") as Promise<string>,
  },
});
