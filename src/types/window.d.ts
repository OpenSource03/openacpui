import type { ClaudeEvent } from "./protocol";
import type {
  CCSessionInfo, PersistedSession, Project, UIMessage, Space,
  SearchMessageResult, SearchSessionResult,
  GitRepoInfo, GitStatus, GitBranch, GitLogEntry,
  AgentDefinition, ModelInfo, McpServerConfig, McpServerStatus,
  AppSettings,
} from "./ui";
import type { ACPSessionEvent, ACPPermissionEvent, ACPTurnCompleteEvent, ACPConfigOption } from "./acp";
import type { EngineId, PermissionBehavior } from "./engine";
import type { CodexSessionEvent, CodexApprovalRequest, CodexExitEvent } from "./codex";
import type { Model as CodexModel } from "./codex-protocol/v2/Model";

interface SessionListItem {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  /** Timestamp of the most recent message — used for sidebar sort order */
  lastMessageAt: number;
  model?: string;
  totalCost: number;
  engine?: EngineId;
}

declare global {
  interface Window {
    claude: {
      getGlassEnabled: () => Promise<boolean>;
      setMinWidth: (width: number) => void;
      start: (options?: {
        cwd?: string;
        model?: string;
        permissionMode?: string;
        resume?: string;
        /** Fork to a new session ID when resuming (model forgets messages after resumeSessionAt) */
        forkSession?: boolean;
        /** Resume at a specific message UUID — used with forkSession to truncate history */
        resumeSessionAt?: string;
        mcpServers?: McpServerConfig[];
      }) => Promise<{ sessionId: string; pid: number; error?: string }>;
      send: (
        sessionId: string,
        message: { type: string; message: { role: string; content: string | Array<{ type: string; [key: string]: unknown }> } },
      ) => Promise<{ ok?: boolean; error?: string }>;
      stop: (sessionId: string) => Promise<{ ok: boolean }>;
      interrupt: (sessionId: string) => Promise<{ ok?: boolean; error?: string }>;
      supportedModels: (sessionId: string) => Promise<{ models: ModelInfo[]; error?: string }>;
      mcpStatus: (sessionId: string) => Promise<{ servers: McpServerStatus[]; error?: string }>;
      mcpReconnect: (sessionId: string, serverName: string) => Promise<{ ok?: boolean; error?: string; restarted?: boolean }>;
      revertFiles: (sessionId: string, checkpointId: string) => Promise<{ ok?: boolean; error?: string }>;
      restartSession: (sessionId: string, mcpServers?: McpServerConfig[]) => Promise<{ ok?: boolean; error?: string; restarted?: boolean }>;
      readFile: (filePath: string) => Promise<{ content?: string; error?: string }>;
      openInEditor: (filePath: string, line?: number, editor?: string) => Promise<{ ok?: boolean; editor?: string; error?: string }>;
      generateTitle: (
        message: string,
        cwd?: string,
        engine?: EngineId,
        sessionId?: string,
      ) => Promise<{ title?: string; error?: string }>;
      log: (label: string, data: unknown) => void;
      onEvent: (callback: (event: ClaudeEvent & { _sessionId: string }) => void) => () => void;
      onStderr: (callback: (data: { data: string; _sessionId: string }) => void) => () => void;
      onExit: (callback: (data: { code: number | null; _sessionId: string; error?: string }) => void) => () => void;
      onPermissionRequest: (
        callback: (data: {
          _sessionId: string;
          requestId: string;
          toolName: string;
          toolInput: Record<string, unknown>;
          toolUseId: string;
          suggestions?: string[];
          decisionReason?: string;
        }) => void,
      ) => () => void;
      respondPermission: (
        sessionId: string,
        requestId: string,
        behavior: PermissionBehavior,
        toolUseId: string,
        toolInput: Record<string, unknown>,
        newPermissionMode?: string,
      ) => Promise<{ ok?: boolean; error?: string }>;
      setPermissionMode: (
        sessionId: string,
        permissionMode: string,
      ) => Promise<{ ok?: boolean; error?: string }>;
      setModel: (
        sessionId: string,
        model: string,
      ) => Promise<{ ok?: boolean; error?: string }>;
      projects: {
        list: () => Promise<Project[]>;
        create: (spaceId?: string) => Promise<Project | null>;
        delete: (projectId: string) => Promise<{ ok?: boolean; error?: string }>;
        rename: (projectId: string, name: string) => Promise<{ ok?: boolean; error?: string }>;
        updateSpace: (projectId: string, spaceId: string) => Promise<{ ok?: boolean; error?: string }>;
        reorder: (projectId: string, targetProjectId: string) => Promise<{ ok?: boolean; error?: string }>;
      };
      sessions: {
        save: (data: PersistedSession) => Promise<{ ok?: boolean; error?: string }>;
        load: (projectId: string, sessionId: string) => Promise<PersistedSession | null>;
        list: (projectId: string) => Promise<SessionListItem[]>;
        delete: (projectId: string, sessionId: string) => Promise<{ ok?: boolean; error?: string }>;
        search: (projectIds: string[], query: string) => Promise<{
          messageResults: SearchMessageResult[];
          sessionResults: SearchSessionResult[];
        }>;
      };
      spaces: {
        list: () => Promise<Space[]>;
        save: (spaces: Space[]) => Promise<{ ok?: boolean; error?: string }>;
      };
      ccSessions: {
        list: (projectPath: string) => Promise<CCSessionInfo[]>;
        import: (projectPath: string, ccSessionId: string) => Promise<{
          messages?: UIMessage[];
          ccSessionId?: string;
          error?: string;
        }>;
      };
      files: {
        list: (cwd: string) => Promise<{ files: string[]; dirs: string[] }>;
        readMultiple: (
          cwd: string,
          paths: string[],
        ) => Promise<
          Array<
            | { path: string; content: string; isDir?: false; error?: undefined }
            | { path: string; isDir: true; tree: string; error?: undefined }
            | { path: string; error: string; content?: undefined; isDir?: undefined }
          >
        >;
      };
      git: {
        discoverRepos: (projectPath: string) => Promise<GitRepoInfo[]>;
        status: (cwd: string) => Promise<GitStatus & { error?: string }>;
        stage: (cwd: string, files: string[]) => Promise<{ ok?: boolean; error?: string }>;
        unstage: (cwd: string, files: string[]) => Promise<{ ok?: boolean; error?: string }>;
        stageAll: (cwd: string) => Promise<{ ok?: boolean; error?: string }>;
        unstageAll: (cwd: string) => Promise<{ ok?: boolean; error?: string }>;
        discard: (cwd: string, files: string[]) => Promise<{ ok?: boolean; error?: string }>;
        commit: (cwd: string, message: string) => Promise<{ ok?: boolean; output?: string; error?: string }>;
        branches: (cwd: string) => Promise<GitBranch[] & { error?: string }>;
        checkout: (cwd: string, branch: string) => Promise<{ ok?: boolean; error?: string }>;
        createBranch: (cwd: string, name: string) => Promise<{ ok?: boolean; error?: string }>;
        createWorktree: (cwd: string, path: string, branch: string, fromRef?: string) => Promise<{ ok?: boolean; path?: string; output?: string; error?: string }>;
        removeWorktree: (cwd: string, path: string, force?: boolean) => Promise<{ ok?: boolean; output?: string; error?: string }>;
        pruneWorktrees: (cwd: string) => Promise<{ ok?: boolean; output?: string; error?: string }>;
        push: (cwd: string) => Promise<{ ok?: boolean; output?: string; error?: string }>;
        pull: (cwd: string) => Promise<{ ok?: boolean; output?: string; error?: string }>;
        fetch: (cwd: string) => Promise<{ ok?: boolean; output?: string; error?: string }>;
        diffFile: (cwd: string, file: string, staged: boolean) => Promise<{ diff?: string; error?: string }>;
        log: (cwd: string, count?: number) => Promise<GitLogEntry[]>;
        generateCommitMessage: (
          cwd: string,
          engine?: EngineId,
          sessionId?: string,
        ) => Promise<{ message?: string; error?: string }>;
      };
      terminal: {
        create: (options: { cwd?: string; cols?: number; rows?: number }) => Promise<{ terminalId?: string; error?: string }>;
        write: (terminalId: string, data: string) => Promise<{ ok?: boolean; error?: string }>;
        resize: (terminalId: string, cols: number, rows: number) => Promise<{ ok?: boolean; error?: string }>;
        destroy: (terminalId: string) => Promise<{ ok?: boolean }>;
        onData: (callback: (data: { terminalId: string; data: string }) => void) => () => void;
        onExit: (callback: (data: { terminalId: string; exitCode: number }) => void) => () => void;
      };
      acp: {
        log: (label: string, data: unknown) => void;
        start: (options: { agentId: string; cwd: string; mcpServers?: McpServerConfig[] }) => Promise<{
          sessionId?: string;
          agentSessionId?: string;
          agentName?: string;
          configOptions?: ACPConfigOption[];
          mcpStatuses?: Array<{ name: string; status: string }>;
          error?: string;
          cancelled?: boolean;
        }>;
        prompt: (sessionId: string, text: string, images?: unknown[]) => Promise<{ ok?: boolean; error?: string }>;
        stop: (sessionId: string) => Promise<{ ok?: boolean; error?: string }>;
        reloadSession: (sessionId: string, mcpServers?: McpServerConfig[]) => Promise<{ ok?: boolean; supportsLoad?: boolean; error?: string }>;
        reviveSession: (options: { agentId: string; cwd: string; agentSessionId?: string; mcpServers?: McpServerConfig[] }) => Promise<{ sessionId?: string; agentSessionId?: string; usedLoad?: boolean; configOptions?: ACPConfigOption[]; mcpStatuses?: Array<{ name: string; status: string }>; error?: string }>;
        cancel: (sessionId: string) => Promise<{ ok?: boolean; error?: string }>;
        abortPendingStart: () => Promise<{ ok?: boolean }>;
        respondPermission: (sessionId: string, requestId: string, optionId: string) => Promise<{ ok?: boolean; error?: string }>;
        setConfig: (sessionId: string, configId: string, value: string) => Promise<{ configOptions?: ACPConfigOption[]; error?: string }>;
        getConfigOptions: (sessionId: string) => Promise<{ configOptions?: ACPConfigOption[] }>;
        onEvent: (callback: (data: ACPSessionEvent) => void) => () => void;
        onPermissionRequest: (callback: (data: ACPPermissionEvent) => void) => () => void;
        onTurnComplete: (callback: (data: ACPTurnCompleteEvent) => void) => () => void;
        onExit: (callback: (data: { _sessionId: string; code: number | null; error?: string }) => void) => () => void;
      };
      codex: {
        start: (options: { cwd: string; model?: string; approvalPolicy?: string; personality?: string }) =>
          Promise<{
            sessionId?: string;
            threadId?: string;
            models?: CodexModel[];
            selectedModel?: string;
            account?: unknown;
            needsAuth?: boolean;
            error?: string;
          }>;
        send: (sessionId: string, text: string, images?: unknown[], effort?: string) =>
          Promise<{ turnId?: string; error?: string }>;
        stop: (sessionId: string) => Promise<void>;
        interrupt: (sessionId: string) => Promise<{ error?: string }>;
        respondApproval: (sessionId: string, rpcId: number, decision: string, acceptSettings?: unknown) =>
          Promise<void>;
        compact: (sessionId: string) => Promise<{ error?: string }>;
        listModels: () => Promise<{ models: CodexModel[]; error?: string }>;
        authStatus: () => Promise<{ account: unknown; requiresOpenaiAuth: boolean }>;
        login: (sessionId: string, type: string, apiKey?: string) => Promise<unknown>;
        resume: (options: { cwd: string; threadId: string; model?: string }) =>
          Promise<{ sessionId?: string; threadId?: string; error?: string }>;
        setModel: (sessionId: string, model: string) => Promise<{ error?: string }>;
        version: () => Promise<{ version?: string; error?: string }>;
        onEvent: (callback: (data: CodexSessionEvent) => void) => () => void;
        onApprovalRequest: (callback: (data: CodexApprovalRequest) => void) => () => void;
        onExit: (callback: (data: CodexExitEvent) => void) => () => void;
      };
      mcp: {
        list: (projectId: string) => Promise<McpServerConfig[]>;
        add: (projectId: string, server: McpServerConfig) => Promise<{ ok?: boolean; error?: string }>;
        remove: (projectId: string, name: string) => Promise<{ ok?: boolean; error?: string }>;
        authenticate: (serverName: string, serverUrl: string) => Promise<{ ok?: boolean; error?: string }>;
        authStatus: (serverName: string) => Promise<{ hasToken: boolean; expiresAt?: number }>;
        probe: (servers: McpServerConfig[]) => Promise<Array<{ name: string; status: "connected" | "needs-auth" | "failed"; error?: string }>>;
      };
      agents: {
        list: () => Promise<AgentDefinition[]>;
        save: (agent: AgentDefinition) => Promise<{ ok?: boolean; error?: string }>;
        delete: (id: string) => Promise<{ ok?: boolean; error?: string }>;
        updateCachedConfig: (agentId: string, configOptions: ACPConfigOption[]) => Promise<{ ok?: boolean }>;
      };
      settings: {
        get: () => Promise<AppSettings>;
        set: (patch: Partial<AppSettings>) => Promise<{ ok?: boolean; error?: string }>;
      };
      speech: {
        /** Triggers macOS native dictation (Cocoa startDictation: selector). Returns { ok: false } on non-macOS. */
        startNativeDictation: () => Promise<{ ok: boolean; reason?: string }>;
        /** Returns the OS platform string (darwin, win32, linux) */
        getPlatform: () => Promise<string>;
        /** Requests microphone permission (macOS system dialog). Returns { granted } on all platforms. */
        requestMicPermission: () => Promise<{ granted: boolean }>;
      };
      updater: {
        onUpdateAvailable: (cb: (info: { version: string; releaseNotes?: string }) => void) => () => void;
        onDownloadProgress: (cb: (progress: { percent: number; bytesPerSecond: number; total: number; transferred: number }) => void) => () => void;
        onUpdateDownloaded: (cb: (info: { version: string }) => void) => () => void;
        onInstallError: (cb: (error: { message: string }) => void) => () => void;
        download: () => Promise<unknown>;
        install: () => Promise<void>;
        check: () => Promise<unknown>;
        currentVersion: () => Promise<string>;
      };
    };
  }
}
