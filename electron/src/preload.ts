import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

interface PreloadDocument {
  documentElement: {
    classList: {
      add: (token: string) => void;
    };
  };
}

interface PreloadStorage {
  getItem: (key: string) => string | null;
}

interface PreloadGlobals {
  document?: PreloadDocument;
  localStorage?: PreloadStorage;
}

// Early setup wrapped in try/catch so contextBridge.exposeInMainWorld always runs
// even if DOM isn't ready or something else fails above it.
try {
  const globals = globalThis as typeof globalThis & PreloadGlobals;
  const root = globals.document?.documentElement;

  // Apply platform + glass classes as early as possible (before React mounts).
  // On Windows, glass support does not mean the user has transparency enabled.
  root?.classList.add(`platform-${process.platform}`);
  ipcRenderer.invoke("app:getGlassSupported").then((supported: boolean) => {
    if (!supported || !root) return;

    const transparencySetting = globals.localStorage?.getItem("harnss-transparency") ?? null;
    const transparencyEnabled = transparencySetting === null || transparencySetting === "true";

    if (transparencyEnabled) {
      root.classList.add("glass-enabled");
    }
  });
} catch (e) {
  console.error("[preload] early setup failed:", e);
}

contextBridge.exposeInMainWorld("claude", {
  getGlassSupported: () => ipcRenderer.invoke("app:getGlassSupported"),
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
  respondPermission: (sessionId: string, requestId: string, behavior: string, toolUseId: string, toolInput: unknown, newPermissionMode?: string, updatedPermissions?: unknown[]) =>
    ipcRenderer.invoke("claude:permission_response", { sessionId, requestId, behavior, toolUseId, toolInput, newPermissionMode, updatedPermissions }),
  setPermissionMode: (sessionId: string, permissionMode: string) =>
    ipcRenderer.invoke("claude:set-permission-mode", { sessionId, permissionMode }),
  setModel: (sessionId: string, model: string) =>
    ipcRenderer.invoke("claude:set-model", { sessionId, model }),
  setThinking: (sessionId: string, thinkingEnabled: boolean) =>
    ipcRenderer.invoke("claude:set-thinking", { sessionId, thinkingEnabled }),
  version: () => ipcRenderer.invoke("claude:version"),
  binaryStatus: () => ipcRenderer.invoke("claude:binary-status"),
  supportedModels: (sessionId: string) => ipcRenderer.invoke("claude:supported-models", sessionId),
  slashCommands: (sessionId: string) => ipcRenderer.invoke("claude:slash-commands", sessionId),
  modelsCacheGet: () => ipcRenderer.invoke("claude:models-cache:get"),
  modelsCacheRevalidate: (options?: { cwd?: string }) => ipcRenderer.invoke("claude:models-cache:revalidate", options),
  mcpStatus: (sessionId: string) => ipcRenderer.invoke("claude:mcp-status", sessionId),
  mcpReconnect: (sessionId: string, serverName: string) =>
    ipcRenderer.invoke("claude:mcp-reconnect", { sessionId, serverName }),
  revertFiles: (sessionId: string, checkpointId: string) =>
    ipcRenderer.invoke("claude:revert-files", { sessionId, checkpointId }),
  restartSession: (sessionId: string, mcpServers?: unknown[], cwd?: string, effort?: string, model?: string) =>
    ipcRenderer.invoke("claude:restart-session", { sessionId, mcpServers, cwd, effort, model }),
  readFile: (filePath: string) => ipcRenderer.invoke("file:read", filePath),
  openInEditor: (filePath: string, line?: number, editor?: string) => ipcRenderer.invoke("file:open-in-editor", { filePath, line, editor }),
  openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),
  generateTitle: (message: string, cwd?: string, engine?: string, sessionId?: string) =>
    ipcRenderer.invoke("claude:generate-title", { message, cwd, engine, sessionId }),
  projects: {
    list: () => ipcRenderer.invoke("projects:list"),
    create: (spaceId?: string) => ipcRenderer.invoke("projects:create", spaceId),
    createDev: (name: string, spaceId?: string) => ipcRenderer.invoke("projects:create-dev", name, spaceId),
    delete: (projectId: string) => ipcRenderer.invoke("projects:delete", projectId),
    rename: (projectId: string, name: string) => ipcRenderer.invoke("projects:rename", projectId, name),
    updateSpace: (projectId: string, spaceId: string) => ipcRenderer.invoke("projects:update-space", projectId, spaceId),
    updateIcon: (projectId: string, icon: string | null, iconType: "emoji" | "lucide" | null) => ipcRenderer.invoke("projects:update-icon", projectId, icon, iconType),
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
    listAll: (cwd: string) => ipcRenderer.invoke("files:list-all", cwd),
    watch: (cwd: string) => ipcRenderer.invoke("files:watch", cwd),
    unwatch: (cwd: string) => ipcRenderer.invoke("files:unwatch", cwd),
    readMultiple: (cwd: string, paths: string[]) => ipcRenderer.invoke("files:read-multiple", { cwd, paths }),
    createFile: (cwd: string, path: string, content?: string) => ipcRenderer.invoke("files:create-file", { cwd, path, content }),
    createDirectory: (cwd: string, path: string) => ipcRenderer.invoke("files:create-directory", { cwd, path }),
    writeFile: (cwd: string, path: string, content: string) => ipcRenderer.invoke("files:write-file", { cwd, path, content }),
    rename: (cwd: string, fromPath: string, toPath: string) => ipcRenderer.invoke("files:rename", { cwd, fromPath, toPath }),
    copy: (cwd: string, fromPath: string, toPath: string) => ipcRenderer.invoke("files:copy", { cwd, fromPath, toPath }),
    delete: (cwd: string, path: string) => ipcRenderer.invoke("files:delete", { cwd, path }),
    onChanged: (callback: (data: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("files:changed", listener);
      return () => ipcRenderer.removeListener("files:changed", listener);
    },
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
    diffStat: (cwd: string) => ipcRenderer.invoke("git:diff-stat", cwd) as Promise<{ additions: number; deletions: number }>,
    showFileAtHead: (cwd: string, file: string) => ipcRenderer.invoke("git:show-file-at-head", { cwd, file }),
    reflog: (cwd: string, count?: number) => ipcRenderer.invoke("git:reflog", { cwd, count }),
    undo: (cwd: string) => ipcRenderer.invoke("git:undo", cwd),
    stashList: (cwd: string) => ipcRenderer.invoke("git:stash-list", cwd),
    stashSave: (cwd: string, message?: string) => ipcRenderer.invoke("git:stash-save", { cwd, message }),
    stashPop: (cwd: string, ref?: string) => ipcRenderer.invoke("git:stash-pop", { cwd, ref }),
    stashApply: (cwd: string, ref?: string) => ipcRenderer.invoke("git:stash-apply", { cwd, ref }),
    stashDrop: (cwd: string, ref?: string) => ipcRenderer.invoke("git:stash-drop", { cwd, ref }),
    cherryPick: (cwd: string, hash: string) => ipcRenderer.invoke("git:cherry-pick", { cwd, hash }),
    blame: (cwd: string, file: string) => ipcRenderer.invoke("git:blame", { cwd, file }),
    log: (cwd: string, count?: number) => ipcRenderer.invoke("git:log", { cwd, count }),
    generateCommitMessage: (cwd: string, engine?: string, sessionId?: string) =>
      ipcRenderer.invoke("git:generate-commit-message", { cwd, engine, sessionId }),
  },
  terminal: {
    create: (options: { cwd?: string; cols?: number; rows?: number; spaceId?: string }) => ipcRenderer.invoke("terminal:create", options),
    list: () => ipcRenderer.invoke("terminal:list"),
    snapshot: (terminalId: string) => ipcRenderer.invoke("terminal:snapshot", terminalId),
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
    reloadSession: (sessionId: string, mcpServers?: unknown[], cwd?: string) =>
      ipcRenderer.invoke("acp:reload-session", { sessionId, mcpServers, cwd }),
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
    getAvailableCommands: (sessionId: string) =>
      ipcRenderer.invoke("acp:get-available-commands", sessionId),
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
    start: (options: { cwd: string; model?: string; approvalPolicy?: string; sandbox?: "read-only" | "workspace-write" | "danger-full-access"; personality?: string; collaborationMode?: { mode: string; settings: { model: string; reasoning_effort: string | null; developer_instructions: string | null } } }) =>
      ipcRenderer.invoke("codex:start", options),
    send: (sessionId: string, text: string, images?: Array<{ type: "image"; url: string } | { type: "localImage"; path: string }>, effort?: string, collaborationMode?: { mode: string; settings: { model: string; reasoning_effort: string | null; developer_instructions: string | null } }) =>
      ipcRenderer.invoke("codex:send", { sessionId, text, images, effort, collaborationMode }),
    stop: (sessionId: string) => ipcRenderer.invoke("codex:stop", sessionId),
    interrupt: (sessionId: string) => ipcRenderer.invoke("codex:interrupt", sessionId),
    respondApproval: (sessionId: string, rpcId: string | number, decision: string, acceptSettings?: unknown) =>
      ipcRenderer.invoke("codex:approval_response", { sessionId, rpcId, decision, acceptSettings }),
    respondUserInput: (sessionId: string, rpcId: string | number, answers: Record<string, { answers: string[] }>) =>
      ipcRenderer.invoke("codex:user_input_response", { sessionId, rpcId, answers }),
    respondServerRequestError: (sessionId: string, rpcId: string | number, code: number, message: string) =>
      ipcRenderer.invoke("codex:server_request_error", { sessionId, rpcId, code, message }),
    compact: (sessionId: string) => ipcRenderer.invoke("codex:compact", sessionId),
    listSkills: (sessionId: string) => ipcRenderer.invoke("codex:list-skills", sessionId),
    listApps: (sessionId: string) => ipcRenderer.invoke("codex:list-apps", sessionId),
    listModels: () => ipcRenderer.invoke("codex:list-models"),
    authStatus: () => ipcRenderer.invoke("codex:auth-status"),
    login: (sessionId: string, type: "apiKey" | "chatgpt", apiKey?: string) =>
      ipcRenderer.invoke("codex:login", { sessionId, type, apiKey }),
    resume: (options: { cwd: string; threadId: string; model?: string; approvalPolicy?: string; sandbox?: "read-only" | "workspace-write" | "danger-full-access" }) =>
      ipcRenderer.invoke("codex:resume", options),
    setModel: (sessionId: string, model: string) =>
      ipcRenderer.invoke("codex:set-model", { sessionId, model }),
    version: () => ipcRenderer.invoke("codex:version"),
    binaryStatus: () => ipcRenderer.invoke("codex:binary-status"),
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
  openclaw: {
    start: (options: { cwd: string; gatewayUrl?: string; model?: string; skills?: string[] }) =>
      ipcRenderer.invoke("openclaw:start", options),
    send: (sessionId: string, text: string) =>
      ipcRenderer.invoke("openclaw:send", { sessionId, text }),
    stop: (sessionId: string) => ipcRenderer.invoke("openclaw:stop", sessionId),
    interrupt: (sessionId: string) => ipcRenderer.invoke("openclaw:interrupt", sessionId),
    status: () => ipcRenderer.invoke("openclaw:status"),
    spawnAgent: (sessionId: string, agentName: string, prompt: string, skills?: string[]) =>
      ipcRenderer.invoke("openclaw:spawn-agent", { sessionId, agentName, prompt, skills }),
    listAgents: (sessionId: string) => ipcRenderer.invoke("openclaw:list-agents", sessionId),
    onEvent: (callback: (data: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("openclaw:event", listener);
      return () => ipcRenderer.removeListener("openclaw:event", listener);
    },
    onExit: (callback: (data: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("openclaw:exit", listener);
      return () => ipcRenderer.removeListener("openclaw:exit", listener);
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
    checkBinaries: (agents: Array<{ id: string; binary: Record<string, { cmd: string; args?: string[] }> }>) =>
      ipcRenderer.invoke("agents:check-binaries", agents),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke("settings:set", patch),
  },
  jira: {
    getConfig: (projectId: string) => ipcRenderer.invoke("jira:get-config", projectId),
    saveConfig: (projectId: string, config: unknown) =>
      ipcRenderer.invoke("jira:save-config", { projectId, config }),
    deleteConfig: (projectId: string) => ipcRenderer.invoke("jira:delete-config", projectId),
    authenticate: (instanceUrl: string, method: "oauth" | "apitoken", apiToken?: string, email?: string) =>
      ipcRenderer.invoke("jira:authenticate", { instanceUrl, method, apiToken, email }),
    authStatus: (instanceUrl: string) => ipcRenderer.invoke("jira:auth-status", instanceUrl),
    logout: (instanceUrl: string) => ipcRenderer.invoke("jira:logout", instanceUrl),
    getProjects: (instanceUrl: string) => ipcRenderer.invoke("jira:get-projects", instanceUrl),
    getBoards: (params: { instanceUrl: string; projectKey?: string }) =>
      ipcRenderer.invoke("jira:get-boards", params),
    getBoardConfiguration: (params: { instanceUrl: string; boardId: string }) =>
      ipcRenderer.invoke("jira:get-board-configuration", params),
    getSprints: (params: { instanceUrl: string; boardId: string }) =>
      ipcRenderer.invoke("jira:get-sprints", params),
    getIssues: (params: { instanceUrl: string; boardId: string; sprintId?: string; maxResults?: number }) =>
      ipcRenderer.invoke("jira:get-issues", params),
    getComments: (params: { instanceUrl: string; issueKey: string }) =>
      ipcRenderer.invoke("jira:get-comments", params),
    getTransitions: (params: { instanceUrl: string; issueKey: string }) =>
      ipcRenderer.invoke("jira:get-transitions", params),
    transitionIssue: (params: { instanceUrl: string; issueKey: string; transitionId: string }) =>
      ipcRenderer.invoke("jira:transition-issue", params),
  },
  analytics: {
    capture: (event: string, properties?: Record<string, unknown>) =>
      ipcRenderer.send("analytics:capture", event, properties),
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
