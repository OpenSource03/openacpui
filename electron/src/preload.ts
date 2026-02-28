import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

// Early setup wrapped in try/catch so contextBridge.exposeInMainWorld always runs
// even if DOM isn't ready or something else fails above it.
try {
  // Apply platform + glass classes as early as possible (before React mounts)
  ipcRenderer.invoke("app:getGlassEnabled").then((enabled: boolean) => {
    // Platform class for platform-specific CSS (e.g. hiding macOS traffic-light padding on Windows)
    document.documentElement.classList.add(`platform-${process.platform}`);
    if (enabled) {
      document.documentElement.classList.add("glass-enabled");
    }
  });
} catch (e) {
  console.error("[preload] early setup failed:", e);
}

contextBridge.exposeInMainWorld("claude", {
  getGlassEnabled: () => ipcRenderer.invoke("app:getGlassEnabled"),
  setMinWidth: (width: number) => ipcRenderer.send("app:set-min-width", width),
  start: (options: unknown) => ipcRenderer.invoke("claude:start", options),
  send: (sessionId: string, message: unknown) => ipcRenderer.invoke("claude:send", { sessionId, message }),
  stop: (sessionId: string, reason?: string) =>
    ipcRenderer.invoke("claude:stop", { sessionId, reason }),
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
  setModel: (sessionId: string, model: string) =>
    ipcRenderer.invoke("claude:set-model", { sessionId, model }),
  setThinking: (sessionId: string, thinkingEnabled: boolean) =>
    ipcRenderer.invoke("claude:set-thinking", { sessionId, thinkingEnabled }),
  supportedModels: (sessionId: string) => ipcRenderer.invoke("claude:supported-models", sessionId),
  modelsCacheGet: () => ipcRenderer.invoke("claude:models-cache:get"),
  modelsCacheRevalidate: (options?: { cwd?: string }) => ipcRenderer.invoke("claude:models-cache:revalidate", options),
  mcpStatus: (sessionId: string) => ipcRenderer.invoke("claude:mcp-status", sessionId),
  mcpReconnect: (sessionId: string, serverName: string) =>
    ipcRenderer.invoke("claude:mcp-reconnect", { sessionId, serverName }),
  revertFiles: (sessionId: string, checkpointId: string) =>
    ipcRenderer.invoke("claude:revert-files", { sessionId, checkpointId }),
  restartSession: (sessionId: string, mcpServers?: unknown[]) =>
    ipcRenderer.invoke("claude:restart-session", { sessionId, mcpServers }),
  readFile: (filePath: string) => ipcRenderer.invoke("file:read", filePath),
  openInEditor: (filePath: string, line?: number, editor?: string) => ipcRenderer.invoke("file:open-in-editor", { filePath, line, editor }),
  generateTitle: (message: string, cwd?: string, engine?: string, sessionId?: string) =>
    ipcRenderer.invoke("claude:generate-title", { message, cwd, engine, sessionId }),
  projects: {
    list: () => ipcRenderer.invoke("projects:list"),
    create: (spaceId?: string) => ipcRenderer.invoke("projects:create", spaceId),
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
    createWorktree: (cwd: string, path: string, branch: string, fromRef?: string) => ipcRenderer.invoke("git:create-worktree", { cwd, path, branch, fromRef }),
    removeWorktree: (cwd: string, path: string, force?: boolean) => ipcRenderer.invoke("git:remove-worktree", { cwd, path, force }),
    pruneWorktrees: (cwd: string) => ipcRenderer.invoke("git:prune-worktrees", cwd),
    push: (cwd: string) => ipcRenderer.invoke("git:push", cwd),
    pull: (cwd: string) => ipcRenderer.invoke("git:pull", cwd),
    fetch: (cwd: string) => ipcRenderer.invoke("git:fetch", cwd),
    diffFile: (cwd: string, file: string, staged: boolean) => ipcRenderer.invoke("git:diff-file", { cwd, file, staged }),
    log: (cwd: string, count?: number) => ipcRenderer.invoke("git:log", { cwd, count }),
    generateCommitMessage: (cwd: string, engine?: string, sessionId?: string) =>
      ipcRenderer.invoke("git:generate-commit-message", { cwd, engine, sessionId }),
  },
  terminal: {
    create: (options: { cwd?: string; cols?: number; rows?: number; spaceId?: string }) => ipcRenderer.invoke("terminal:create", options),
    write: (terminalId: string, data: string) => ipcRenderer.invoke("terminal:write", { terminalId, data }),
    resize: (terminalId: string, cols: number, rows: number) => ipcRenderer.invoke("terminal:resize", { terminalId, cols, rows }),
    destroy: (terminalId: string) => ipcRenderer.invoke("terminal:destroy", terminalId),
    destroySpace: (spaceId: string) => ipcRenderer.invoke("terminal:destroy-space", spaceId),
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
    abortPendingStart: () => ipcRenderer.invoke("acp:abort-pending-start"),
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
  codex: {
    log: (label: string, data: unknown) => ipcRenderer.send("codex:log", label, data),
    start: (options: { cwd: string; model?: string; approvalPolicy?: string; personality?: string; collaborationMode?: { mode: string; settings: { model: string; reasoning_effort: string | null; developer_instructions: string | null } } }) =>
      ipcRenderer.invoke("codex:start", options),
    send: (sessionId: string, text: string, images?: Array<{ type: "image"; url: string } | { type: "localImage"; path: string }>, effort?: string, collaborationMode?: { mode: string; settings: { model: string; reasoning_effort: string | null; developer_instructions: string | null } }) =>
      ipcRenderer.invoke("codex:send", { sessionId, text, images, effort, collaborationMode }),
    stop: (sessionId: string) => ipcRenderer.invoke("codex:stop", sessionId),
    interrupt: (sessionId: string) => ipcRenderer.invoke("codex:interrupt", sessionId),
    respondApproval: (sessionId: string, rpcId: number, decision: string, acceptSettings?: unknown) =>
      ipcRenderer.invoke("codex:approval_response", { sessionId, rpcId, decision, acceptSettings }),
    compact: (sessionId: string) => ipcRenderer.invoke("codex:compact", sessionId),
    listModels: () => ipcRenderer.invoke("codex:list-models"),
    authStatus: () => ipcRenderer.invoke("codex:auth-status"),
    login: (sessionId: string, type: "apiKey" | "chatgpt", apiKey?: string) =>
      ipcRenderer.invoke("codex:login", { sessionId, type, apiKey }),
    resume: (options: { cwd: string; threadId: string; model?: string; approvalPolicy?: string }) =>
      ipcRenderer.invoke("codex:resume", options),
    setModel: (sessionId: string, model: string) =>
      ipcRenderer.invoke("codex:set-model", { sessionId, model }),
    version: () => ipcRenderer.invoke("codex:version"),
    onEvent: (callback: (data: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("codex:event", listener);
      return () => ipcRenderer.removeListener("codex:event", listener);
    },
    onApprovalRequest: (callback: (data: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("codex:approval_request", listener);
      return () => ipcRenderer.removeListener("codex:approval_request", listener);
    },
    onExit: (callback: (data: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("codex:exit", listener);
      return () => ipcRenderer.removeListener("codex:exit", listener);
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
    updateCachedConfig: (agentId: string, configOptions: unknown[]) =>
      ipcRenderer.invoke("agents:update-cached-config", agentId, configOptions),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke("settings:set", patch),
  },
  speech: {
    startNativeDictation: () => ipcRenderer.invoke("speech:start-native-dictation"),
    getPlatform: () => ipcRenderer.invoke("speech:get-platform"),
    requestMicPermission: () => ipcRenderer.invoke("speech:request-mic-permission"),
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
    onInstallError: (cb: (error: { message: string }) => void) => {
      const listener = (_event: IpcRendererEvent, error: { message: string }) => cb(error);
      ipcRenderer.on("updater:install-error", listener);
      return () => ipcRenderer.removeListener("updater:install-error", listener);
    },
    download: () => ipcRenderer.invoke("updater:download"),
    install: () => ipcRenderer.invoke("updater:install"),
    check: () => ipcRenderer.invoke("updater:check"),
    currentVersion: () => ipcRenderer.invoke("updater:current-version") as Promise<string>,
  },
});
