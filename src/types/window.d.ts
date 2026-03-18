import type { ClaudeEvent } from "./protocol";
import type {
  CCSessionInfo, PersistedSession, Project, UIMessage, Space,
  SearchMessageResult, SearchSessionResult,
  GitRepoInfo, GitStatus, GitBranch, GitLogEntry,
  InstalledAgent, ModelInfo, McpServerConfig, McpServerStatus,
  AppSettings,
  ClaudeEffort,
} from "./ui";
import type { ACPSessionEvent, ACPPermissionEvent, ACPTurnCompleteEvent, ACPConfigOption } from "./acp";
import type { EngineId, AppPermissionBehavior } from "./engine";
import type { CodexSessionEvent, CodexServerRequest, CodexExitEvent } from "./codex";
import type { OpenClawSessionEvent, OpenClawExitEvent, OpenClawStartOptions, OpenClawConnectResult } from "@shared/types/openclaw";
import type { Model as CodexModel } from "./codex-protocol/v2/Model";
import type { CollaborationMode } from "./codex-protocol/CollaborationMode";
import type { AgentGroup, GroupSessionEvent } from "@/types/groups";
import type {
  JiraProjectConfig,
  JiraBoard,
  JiraIssue,
  JiraSprint,
  JiraComment,
  JiraTransition,
  JiraBoardConfiguration,
  JiraProjectSummary,
  JiraGetBoardsParams,
  JiraGetIssuesParams,
  JiraGetSprintsParams,
  JiraGetCommentsParams,
  JiraGetTransitionsParams,
  JiraTransitionIssueParams,
} from "@shared/types/jira";

interface SessionListItem {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  lastMessageAt: number;
  model?: string;
  planMode?: boolean;
  totalCost: number;
  engine?: EngineId;
  codexThreadId?: string;
}

type CodexImageInput = { type: "image"; url: string } | { type: "localImage"; path: string };

declare global {
  interface Window {
    claude: {
      getGlassSupported: () => Promise<boolean>;
      setMinWidth: (width: number) => void;
      start: (options?: {
        cwd?: string;
        model?: string;
        permissionMode?: string;
        thinkingEnabled?: boolean;
        effort?: ClaudeEffort;
        resume?: string;
        forkSession?: boolean;
        resumeSessionAt?: string;
        mcpServers?: McpServerConfig[];
      }) => Promise<{ sessionId: string; pid: number; error?: string }>;
      send: (
        sessionId: string,
        message: { type: string; message: { role: string; content: string | Array<{ type: string; [key: string]: unknown }> } },
      ) => Promise<{ ok?: boolean; error?: string }>;
      stop: (sessionId: string, reason?: string) => Promise<{ ok: boolean }>;
      interrupt: (sessionId: string) => Promise<{ ok?: boolean; error?: string }>;
      supportedModels: (sessionId: string) => Promise<{ models: ModelInfo[]; error?: string }>;
      slashCommands: (sessionId: string) => Promise<{
        commands: Array<{ name: string; description?: string; argumentHint?: string }>;
        error?: string;
      }>;
      modelsCacheGet: () => Promise<{ models: ModelInfo[]; updatedAt?: number; error?: string }>;
      modelsCacheRevalidate: (options?: { cwd?: string }) => Promise<{ models: ModelInfo[]; updatedAt?: number; error?: string }>;
      mcpStatus: (sessionId: string) => Promise<{ servers: McpServerStatus[]; error?: string }>;
      mcpReconnect: (sessionId: string, serverName: string) => Promise<{ ok?: boolean; error?: string; restarted?: boolean }>;
      revertFiles: (sessionId: string, checkpointId: string) => Promise<{ ok?: boolean; error?: string }>;
      restartSession: (sessionId: string, mcpServers?: McpServerConfig[], cwd?: string, effort?: ClaudeEffort, model?: string) => Promise<{ ok?: boolean; error?: string; restarted?: boolean }>;
      readFile: (filePath: string) => Promise<{ content?: string; error?: string }>;
      openInEditor: (filePath: string, line?: number, editor?: string) => Promise<{ ok?: boolean; editor?: string; error?: string }>;
      openExternal: (url: string) => Promise<{ ok?: boolean; error?: string }>;
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
          suggestions?: unknown[];
          decisionReason?: string;
        }) => void,
      ) => () => void;
      respondPermission: (
        sessionId: string,
        requestId: string,
        behavior: AppPermissionBehavior,
        toolUseId: string,
        toolInput: Record<string, unknown>,
        newPermissionMode?: string,
        updatedPermissions?: unknown[],
      ) => Promise<{ ok?: boolean; error?: string }>;
      setPermissionMode: (
        sessionId: string,
        permissionMode: string,
      ) => Promise<{ ok?: boolean; error?: string }>;
      setModel: (
        sessionId: string,
        model: string,
      ) => Promise<{ ok?: boolean; error?: string }>;
      setThinking: (
        sessionId: string,
        thinkingEnabled: boolean,
      ) => Promise<{ ok?: boolean; error?: string }>;
      version: () => Promise<{ version?: string | null; error?: string }>;
      binaryStatus: () => Promise<{ installed: boolean; installing: boolean }>;
      projects: {
        list: () => Promise<Project[]>;
        create: (spaceId?: string) => Promise<Project | null>;
        createDev: (name: string, spaceId?: string) => Promise<Project | null>;
        delete: (projectId: string) => Promise<{ ok?: boolean; error?: string }>;
        rename: (projectId: string, name: string) => Promise<{ ok?: boolean; error?: string }>;
        updateSpace: (projectId: string, spaceId: string) => Promise<{ ok?: boolean; error?: string }>;
        updateIcon: (projectId: string, icon: string | null, iconType: "emoji" | "lucide" | null) => Promise<{ ok?: boolean; error?: string }>;
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
        listAll: (cwd: string) => Promise<{ files: string[]; dirs: string[] }>;
        watch: (cwd: string) => Promise<{ ok?: boolean; error?: string }>;
        unwatch: (cwd: string) => Promise<{ ok?: boolean; error?: string }>;
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
        createFile: (cwd: string, path: string, content?: string) => Promise<{ ok?: boolean; error?: string }>;
        createDirectory: (cwd: string, path: string) => Promise<{ ok?: boolean; error?: string }>;
        writeFile: (cwd: string, path: string, content: string) => Promise<{ ok?: boolean; error?: string }>;
        rename: (cwd: string, fromPath: string, toPath: string) => Promise<{ ok?: boolean; error?: string }>;
        copy: (cwd: string, fromPath: string, toPath: string) => Promise<{ ok?: boolean; error?: string }>;
        delete: (cwd: string, path: string) => Promise<{ ok?: boolean; error?: string }>;
        onChanged: (callback: (data: { cwd: string }) => void) => () => void;
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
        branches: (cwd: string) => Promise<GitBranch[] | { error: string }>;
        checkout: (cwd: string, branch: string) => Promise<{ ok?: boolean; error?: string }>;
        createBranch: (cwd: string, name: string) => Promise<{ ok?: boolean; error?: string }>;
        createWorktree: (cwd: string, path: string, branch: string, fromRef?: string) => Promise<{ ok?: boolean; path?: string; output?: string; error?: string }>;
        removeWorktree: (cwd: string, path: string, force?: boolean) => Promise<{ ok?: boolean; output?: string; error?: string }>;
        pruneWorktrees: (cwd: string) => Promise<{ ok?: boolean; output?: string; error?: string }>;
        push: (cwd: string) => Promise<{ ok?: boolean; output?: string; error?: string }>;
        pull: (cwd: string) => Promise<{ ok?: boolean; output?: string; error?: string }>;
        fetch: (cwd: string) => Promise<{ ok?: boolean; output?: string; error?: string }>;
        diffFile: (cwd: string, file: string, staged: boolean) => Promise<{ diff?: string; error?: string }>;
        diffStat: (cwd: string) => Promise<{ additions: number; deletions: number }>;
        showFileAtHead: (cwd: string, file: string) => Promise<{ content?: string; error?: string }>;
        reflog: (cwd: string, count?: number) => Promise<{ entries: Array<{ hash: string; ref: string; subject: string; date: string }>; error?: string }>;
        undo: (cwd: string) => Promise<{ success?: boolean; hash?: string; error?: string }>;
        stashList: (cwd: string) => Promise<{ stashes: Array<{ ref: string; message: string; date: string }> }>;
        stashSave: (cwd: string, message?: string) => Promise<{ success?: boolean; error?: string }>;
        stashPop: (cwd: string, ref?: string) => Promise<{ success?: boolean; error?: string }>;
        stashApply: (cwd: string, ref?: string) => Promise<{ success?: boolean; error?: string }>;
        stashDrop: (cwd: string, ref?: string) => Promise<{ success?: boolean; error?: string }>;
        cherryPick: (cwd: string, hash: string) => Promise<{ success?: boolean; error?: string }>;
        blame: (cwd: string, file: string) => Promise<{ lines?: Array<{ hash: string; author: string; date: string; lineNumber: number; content: string }>; error?: string }>;
        log: (cwd: string, count?: number) => Promise<GitLogEntry[] | { error: string }>;
        generateCommitMessage: (
          cwd: string,
          engine?: EngineId,
          sessionId?: string,
        ) => Promise<{ message?: string; error?: string }>;
      };
      terminal: {
        create: (options: { cwd?: string; cols?: number; rows?: number; spaceId?: string }) => Promise<{ terminalId?: string; error?: string }>;
        list: () => Promise<{
          terminals?: Array<{
            terminalId: string;
            spaceId: string;
            createdAt: number;
            exited: boolean;
            exitCode: number | null;
          }>;
          error?: string;
        }>;
        snapshot: (terminalId: string) => Promise<{
          output?: string;
          seq?: number;
          exited?: boolean;
          exitCode?: number | null;
          error?: string;
        }>;
        write: (terminalId: string, data: string) => Promise<{ ok?: boolean; error?: string }>;
        resize: (terminalId: string, cols: number, rows: number) => Promise<{ ok?: boolean; error?: string }>;
        destroy: (terminalId: string) => Promise<{ ok?: boolean }>;
        destroySpace: (spaceId: string) => Promise<{ ok?: boolean }>;
        onData: (callback: (data: { terminalId: string; data: string; seq: number }) => void) => () => void;
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
        reloadSession: (sessionId: string, mcpServers?: McpServerConfig[], cwd?: string) => Promise<{ ok?: boolean; supportsLoad?: boolean; error?: string }>;
        reviveSession: (options: { agentId: string; cwd: string; agentSessionId?: string; mcpServers?: McpServerConfig[] }) => Promise<{ sessionId?: string; agentSessionId?: string; usedLoad?: boolean; configOptions?: ACPConfigOption[]; mcpStatuses?: Array<{ name: string; status: string }>; error?: string }>;
        cancel: (sessionId: string) => Promise<{ ok?: boolean; error?: string }>;
        abortPendingStart: () => Promise<{ ok?: boolean }>;
        respondPermission: (sessionId: string, requestId: string, optionId: string) => Promise<{ ok?: boolean; error?: string }>;
        setConfig: (sessionId: string, configId: string, value: string) => Promise<{ configOptions?: ACPConfigOption[]; error?: string }>;
        getConfigOptions: (sessionId: string) => Promise<{ configOptions?: ACPConfigOption[] }>;
        getAvailableCommands: (sessionId: string) => Promise<{ commands?: import("./acp").ACPAvailableCommand[] }>;
        onEvent: (callback: (data: ACPSessionEvent) => void) => () => void;
        onPermissionRequest: (callback: (data: ACPPermissionEvent) => void) => () => void;
        onTurnComplete: (callback: (data: ACPTurnCompleteEvent) => void) => () => void;
        onExit: (callback: (data: { _sessionId: string; code: number | null; error?: string }) => void) => () => void;
      };
      codex: {
        log: (label: string, data: unknown) => void;
        start: (options: { cwd: string; model?: string; approvalPolicy?: string; sandbox?: "read-only" | "workspace-write" | "danger-full-access"; personality?: string; collaborationMode?: CollaborationMode }) =>
          Promise<{
            sessionId?: string;
            threadId?: string;
            models?: CodexModel[];
            selectedModel?: string;
            account?: unknown;
            needsAuth?: boolean;
            error?: string;
          }>;
        send: (sessionId: string, text: string, images?: CodexImageInput[], effort?: string, collaborationMode?: CollaborationMode) =>
          Promise<{ turnId?: string; error?: string }>;
        stop: (sessionId: string) => Promise<void>;
        interrupt: (sessionId: string) => Promise<{ error?: string }>;
        respondApproval: (sessionId: string, rpcId: string | number, decision: string, acceptSettings?: unknown) =>
          Promise<void>;
        respondUserInput: (
          sessionId: string,
          rpcId: string | number,
          answers: Record<string, { answers: string[] }>,
        ) => Promise<void>;
        respondServerRequestError: (
          sessionId: string,
          rpcId: string | number,
          code: number,
          message: string,
        ) => Promise<void>;
        compact: (sessionId: string) => Promise<{ error?: string }>;
        listSkills: (sessionId: string) => Promise<{
          skills: Array<import("./codex-protocol/v2/SkillsListEntry").SkillsListEntry>;
          error?: string;
        }>;
        listApps: (sessionId: string) => Promise<{
          apps: Array<import("./codex-protocol/v2/AppInfo").AppInfo>;
          error?: string;
        }>;
        listModels: () => Promise<{ models: CodexModel[]; error?: string }>;
        authStatus: () => Promise<{ account: unknown; requiresOpenaiAuth: boolean }>;
        login: (sessionId: string, type: "apiKey" | "chatgpt", apiKey?: string) => Promise<unknown>;
        resume: (options: { cwd: string; threadId: string; model?: string; approvalPolicy?: string; sandbox?: "read-only" | "workspace-write" | "danger-full-access" }) =>
          Promise<{ sessionId?: string; threadId?: string; error?: string }>;
        setModel: (sessionId: string, model: string) => Promise<{ error?: string }>;
        version: () => Promise<{ version?: string; error?: string }>;
        binaryStatus: () => Promise<{ installed: boolean; downloading: boolean }>;
        onEvent: (callback: (data: CodexSessionEvent) => void) => () => void;
        onApprovalRequest: (callback: (data: CodexServerRequest) => void) => () => void;
        onExit: (callback: (data: CodexExitEvent) => void) => () => void;
      };
      openclaw: {
        start: (options: OpenClawStartOptions) => Promise<OpenClawConnectResult>;
        send: (sessionId: string, text: string) => Promise<{ ok?: boolean; error?: string }>;
        stop: (sessionId: string) => Promise<{ ok?: boolean; error?: string }>;
        interrupt: (sessionId: string) => Promise<{ ok?: boolean; error?: string }>;
        status: () => Promise<{ available: boolean; error?: string }>;
        pair: () => Promise<{ ok: boolean; paired?: boolean; version?: string; error?: string }>;
        spawnAgent: (sessionId: string, agentName: string, prompt: string, skills?: string[]) => Promise<{ ok?: boolean; agentId?: string; error?: string }>;
        listAgents: (sessionId?: string) => Promise<{ ok?: boolean; agents?: unknown; error?: string }>;
        onEvent: (callback: (data: OpenClawSessionEvent) => void) => () => void;
        onExit: (callback: (data: OpenClawExitEvent) => void) => () => void;
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
        list: () => Promise<InstalledAgent[]>;
        save: (agent: InstalledAgent) => Promise<{ ok?: boolean; error?: string }>;
        delete: (id: string) => Promise<{ ok?: boolean; error?: string }>;
        updateCachedConfig: (agentId: string, configOptions: ACPConfigOption[]) => Promise<{ ok?: boolean }>;
        checkBinaries: (
          agents: Array<{ id: string; binary: Record<string, { cmd: string; args?: string[] }> }>,
        ) => Promise<Record<string, { path: string; args?: string[] } | null>>;
      };
      settings: {
        get: () => Promise<AppSettings>;
        set: (patch: Partial<AppSettings>) => Promise<{ ok?: boolean; error?: string }>;
      };
      jira: {
        getConfig: (projectId: string) => Promise<JiraProjectConfig | null>;
        saveConfig: (projectId: string, config: JiraProjectConfig) => Promise<void>;
        deleteConfig: (projectId: string) => Promise<void>;
        authenticate: (
          instanceUrl: string,
          method: "oauth" | "apitoken",
          apiToken?: string,
          email?: string
        ) => Promise<{ ok?: boolean; error?: string }>;
        authStatus: (instanceUrl: string) => Promise<{ hasToken: boolean }>;
        logout: (instanceUrl: string) => Promise<void>;
        getProjects: (instanceUrl: string) => Promise<JiraProjectSummary[]>;
        getBoards: (params: JiraGetBoardsParams) => Promise<JiraBoard[]>;
        getBoardConfiguration: (params: JiraGetSprintsParams) => Promise<JiraBoardConfiguration>;
        getSprints: (params: JiraGetSprintsParams) => Promise<JiraSprint[]>;
        getIssues: (params: JiraGetIssuesParams) => Promise<JiraIssue[]>;
        getComments: (params: JiraGetCommentsParams) => Promise<JiraComment[]>;
        getTransitions: (params: JiraGetTransitionsParams) => Promise<JiraTransition[]>;
        transitionIssue: (params: JiraTransitionIssueParams) => Promise<{ ok: true }>;
      };
      analytics: {
        capture: (event: string, properties?: Record<string, unknown>) => void;
      };
      speech: {
        startNativeDictation: () => Promise<{ ok: boolean; reason?: string }>;
        getPlatform: () => Promise<string>;
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
      groups: {
        list: () => Promise<{ ok: boolean; groups?: AgentGroup[]; error?: string }>;
        create: (group: AgentGroup) => Promise<{ ok: boolean; group?: AgentGroup; error?: string }>;
        update: (group: AgentGroup) => Promise<{ ok: boolean; group?: AgentGroup; error?: string }>;
        delete: (groupId: string) => Promise<{ ok: boolean; error?: string }>;
        startSession: (params: { groupId: string; prompt: string; cwd?: string; projectId?: string }) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
        stopSession: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
        generateTeam: (params: { prompt: string; cwd?: string }) => Promise<{ ok: boolean; result?: string; error?: string }>;
        getSession: (sessionId: string) => Promise<{ ok: boolean; session?: unknown; error?: string }>;
        resumeSession: (sessionId: string, projectId?: string) => Promise<{ ok: boolean; error?: string }>;
        sendMessage: (sessionId: string, message: unknown, projectId?: string) => Promise<{ ok?: boolean; error?: string }>;
        interrupt: (sessionId: string) => Promise<{ ok?: boolean; error?: string }>;
        onSlotEvent: (callback: (data: unknown) => void) => () => void;
        respondPermission: (sessionId: string, slotId: string, requestId: string, behavior: string) => Promise<{ ok?: boolean; error?: string }>;
        onPermissionRequest: (callback: (data: unknown) => void) => () => void;
        onEvent: (callback: (data: GroupSessionEvent) => void) => () => void;
      };
    };
  }
}
