import type { ClaudeEvent } from "./protocol";
import type { CCSessionInfo, ChatFolder, PersistedSession, Project, UIMessage, ClaudeEffort } from "./session";
import type { Space } from "./spaces";
import type { SearchMessageResult, SearchSessionResult } from "./search";
import type { ModelInfo, McpServerConfig, McpServerStatus } from "./mcp";
import type { PermissionUpdate } from "./permissions";
import type { GitRepoInfo, GitStatus, GitBranch, GitLogEntry } from "@shared/types/git";
import type { InstalledAgent } from "@shared/types/registry";
import type { AppSettings, MacBackgroundEffect, ThemeOption } from "@shared/types/settings";
import type {
  ACPSessionEvent,
  ACPPermissionEvent,
  ACPTurnCompleteEvent,
  ACPConfigOption,
  ACPAuthenticateResult,
  ACPAvailableCommand,
  ACPAuthMethod,
  ACPStartResult,
  ACPStatusInfo,
} from "./acp";
import type { EngineId, AppPermissionBehavior } from "./engine";
import type { CodexSessionEvent, CodexServerRequest, CodexExitEvent } from "./codex";
import type { Model as CodexModel } from "./codex-protocol/v2/Model";
import type { CollaborationMode } from "./codex-protocol/CollaborationMode";
import type { SkillsListEntry } from "./codex-protocol/v2/SkillsListEntry";
import type { AppInfo } from "./codex-protocol/v2/AppInfo";
import type { SessionMeta as SessionListItem } from "@shared/lib/session-persistence";
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

/** Standard IPC result envelope — most IPC calls return this shape. */
interface IpcResult {
  ok?: boolean;
  error?: string;
}

type CodexImageInput = { type: "image"; url: string } | { type: "localImage"; path: string };

declare global {
  /** Result of the GitHub pre-release check for the running version. */
  interface PreReleaseInfo {
    isPreRelease: boolean;
    version: string;
    releaseUrl: string | null;
  }

  interface Window {
    claude: {
      getGlassSupported: () => Promise<boolean>;
      getMacBackgroundEffectSupport: () => Promise<{ liquidGlass: boolean; vibrancy: boolean }>;
      setThemeSource: (themeSource: ThemeOption) => void;
      setMacBackgroundEffect: (effect: MacBackgroundEffect) => void;
      relaunchApp: () => Promise<IpcResult>;
      setMinWidth: (width: number) => void;
      glass: {
        setTintColor: (tintColor: string | null) => void;
        setTheme: (theme: "light" | "dark" | "system") => void;
      };
      start: (options?: {
        cwd?: string;
        model?: string;
        permissionMode?: string;
        thinkingEnabled?: boolean;
        effort?: ClaudeEffort;
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
      ) => Promise<IpcResult>;
      stop: (sessionId: string, reason?: string) => Promise<{ ok: boolean }>;
      interrupt: (sessionId: string) => Promise<IpcResult>;
      stopTask: (sessionId: string, taskId: string) => Promise<IpcResult>;
      readAgentOutput: (outputFile: string) => Promise<{ messages?: unknown[]; error?: string }>;
      supportedModels: (sessionId: string) => Promise<{ models: ModelInfo[]; error?: string }>;
      slashCommands: (sessionId: string) => Promise<{
        commands: Array<{ name: string; description?: string; argumentHint?: string }>;
        error?: string;
      }>;
      modelsCacheGet: () => Promise<{ models: ModelInfo[]; updatedAt?: number; error?: string }>;
      modelsCacheRevalidate: (options?: { cwd?: string }) => Promise<{ models: ModelInfo[]; updatedAt?: number; error?: string }>;
      mcpStatus: (sessionId: string) => Promise<{ servers: McpServerStatus[]; error?: string }>;
      mcpReconnect: (sessionId: string, serverName: string) => Promise<IpcResult & { restarted?: boolean }>;
      revertFiles: (sessionId: string, checkpointId: string) => Promise<IpcResult>;
      restartSession: (sessionId: string, mcpServers?: McpServerConfig[], cwd?: string, effort?: ClaudeEffort, model?: string) => Promise<IpcResult & { restarted?: boolean }>;
      readFile: (filePath: string) => Promise<{ content?: string; error?: string }>;
      renameFile: (oldPath: string, newPath: string) => Promise<IpcResult>;
      trashItem: (filePath: string) => Promise<IpcResult>;
      newFile: (filePath: string) => Promise<IpcResult>;
      newFolder: (folderPath: string) => Promise<IpcResult>;
      writeClipboardText: (text: string) => Promise<IpcResult>;
      setBrowserColorScheme: (
        targetWebContentsId: number,
        colorScheme: "light" | "dark",
      ) => Promise<IpcResult>;
      openInEditor: (filePath: string, line?: number, editor?: string) => Promise<IpcResult & { editor?: string }>;
      openExternal: (url: string) => Promise<IpcResult>;
      showItemInFolder: (filePath: string) => Promise<IpcResult>;
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
          suggestions?: PermissionUpdate[];
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
      ) => Promise<IpcResult>;
      setPermissionMode: (
        sessionId: string,
        permissionMode: string,
      ) => Promise<IpcResult>;
      setModel: (
        sessionId: string,
        model?: string,
      ) => Promise<IpcResult>;
      setThinking: (
        sessionId: string,
        thinkingEnabled: boolean,
      ) => Promise<IpcResult>;
      version: () => Promise<{ version?: string | null; error?: string }>;
      binaryStatus: () => Promise<{ installed: boolean; installing: boolean }>;
      projects: {
        list: () => Promise<Project[]>;
        create: (spaceId?: string) => Promise<Project | null>;
        createAtPath: (folderPath: string, spaceId?: string) => Promise<{ project: Project; created: boolean } | { error: string }>;
        createDev: (name: string, spaceId?: string) => Promise<Project | null>;
        delete: (projectId: string) => Promise<IpcResult>;
        rename: (projectId: string, name: string) => Promise<IpcResult>;
        updateSpace: (projectId: string, spaceId: string) => Promise<IpcResult>;
        updateIcon: (projectId: string, icon: string | null, iconType: "emoji" | "lucide" | "simple" | null) => Promise<IpcResult>;
        reorder: (projectId: string, targetProjectId: string) => Promise<IpcResult>;
      };
      sessions: {
        save: (data: PersistedSession) => Promise<IpcResult>;
        load: (projectId: string, sessionId: string) => Promise<PersistedSession | null>;
        list: (projectId: string) => Promise<SessionListItem[]>;
        delete: (projectId: string, sessionId: string) => Promise<IpcResult>;
        search: (projectIds: string[], query: string) => Promise<{
          messageResults: SearchMessageResult[];
          sessionResults: SearchSessionResult[];
        }>;
        updateMeta: (projectId: string, sessionId: string, patch: {
          pinned?: boolean;
          folderId?: string | null;
          branch?: string;
          archivedAt?: number | null;
        }) => Promise<IpcResult>;
      };
      folders: {
        list: (projectId: string) => Promise<ChatFolder[]>;
        create: (projectId: string, name: string) => Promise<ChatFolder>;
        delete: (projectId: string, folderId: string) => Promise<IpcResult>;
        rename: (projectId: string, folderId: string, name: string) => Promise<IpcResult>;
        pin: (projectId: string, folderId: string, pinned: boolean) => Promise<IpcResult>;
      };
      spaces: {
        list: () => Promise<Space[]>;
        save: (spaces: Space[]) => Promise<IpcResult>;
      };
      ccSessions: {
        list: (projectPath: string) => Promise<CCSessionInfo[]>;
        /**
         * Aggregate every Claude Code session across every cwd by reading the
         * per-cwd `sessions-index.json` files (with .jsonl scan fallback when
         * the index is missing). Backs the global session browser.
         */
        listAll: () => Promise<Array<{
          sessionId: string;
          cwdHash: string;
          projectPath: string | null;
          firstPrompt: string | null;
          summary: string | null;
          messageCount: number | null;
          modified: number;
          created: number | null;
          gitBranch: string | null;
        }>>;
        import: (projectPath: string, ccSessionId: string) => Promise<{
          messages?: UIMessage[];
          ccSessionId?: string;
          error?: string;
        }>;
        /**
         * Scan ~/.claude/projects/* for a session with the given id.
         * Returns the cwd + preview so the caller can route the import to
         * the right Harnss project (or create one at that path).
         */
        findById: (sessionId: string) => Promise<
          | { found: true;
              ccSessionId: string;
              cwd: string | null;
              cwdFallbackFromDirName?: string;
              cwdIsApproximate?: boolean;
              preview: string | null;
              model: string | null;
              timestamp: string | null;
            }
          | { found: false }
          | { error: string }
        >;
      };
      cli: {
        start: (opts: import("@shared/types/cli-engine").CliStartOptions) =>
          Promise<import("@shared/types/cli-engine").CliStartResult>;
        resume: (opts: import("@shared/types/cli-engine").CliResumeOptions) =>
          Promise<import("@shared/types/cli-engine").CliStartResult>;
        /**
         * Fork a session: spawns `claude --resume <orig> --fork-session`
         * and discovers the new id asynchronously via fs.watch on the
         * project dir. Resolves with a provisional sessionId; the real
         * forked id arrives via the `session_identified` cli:event.
         */
        fork: (opts: { originalSessionId: string; cwd: string; cols?: number; rows?: number }) =>
          Promise<import("@shared/types/cli-engine").CliStartResult>;
        stop: (sessionId: string) => Promise<{ ok: boolean }>;
        listLive: () => Promise<import("@shared/types/cli-engine").CliLiveSession[]>;
        getLive: (sessionId: string) =>
          Promise<import("@shared/types/cli-engine").CliLiveSession | null>;
        archive: (target: import("@shared/types/cli-engine").CliArchiveTarget) =>
          Promise<{ ok: boolean; error?: string }>;
        onEvent: (
          callback: (event: import("@shared/types/cli-engine").CliSessionEvent) => void,
        ) => () => void;
      };
      files: {
        list: (cwd: string) => Promise<{ files: string[]; dirs: string[] }>;
        listAll: (cwd: string) => Promise<{ files: string[]; dirs: string[] }>;
        watch: (cwd: string) => Promise<IpcResult>;
        unwatch: (cwd: string) => Promise<IpcResult>;
        calculateDeepSize: (
          cwd: string,
          paths: string[],
        ) => Promise<{
          totalSize: number;
          fileCount: number;
          estimatedTokens: number;
          warnings: string[];
        }>;
        readMultiple: (
          cwd: string,
          paths: string[],
          deepPaths?: Set<string>,
        ) => Promise<
          Array<
            | { path: string; content: string; isDir?: false; error?: undefined }
            | { path: string; isDir: true; tree: string; error?: undefined }
            | { path: string; error: string; content?: undefined; isDir?: undefined }
          >
        >;
        onChanged: (callback: (data: { cwd: string }) => void) => () => void;
      };
      git: {
        discoverRepos: (projectPath: string) => Promise<GitRepoInfo[]>;
        status: (cwd: string) => Promise<GitStatus | { error: string }>;
        stage: (cwd: string, files: string[]) => Promise<IpcResult>;
        unstage: (cwd: string, files: string[]) => Promise<IpcResult>;
        stageAll: (cwd: string) => Promise<IpcResult>;
        unstageAll: (cwd: string) => Promise<IpcResult>;
        discard: (cwd: string, files: string[]) => Promise<IpcResult>;
        commit: (cwd: string, message: string) => Promise<IpcResult & { output?: string }>;
        branches: (cwd: string) => Promise<GitBranch[] | { error: string }>;
        checkout: (cwd: string, branch: string) => Promise<IpcResult>;
        createBranch: (cwd: string, name: string) => Promise<IpcResult>;
        createWorktree: (cwd: string, path: string, branch: string, fromRef?: string) => Promise<IpcResult & { path?: string; output?: string; setupResults?: Array<{ command: string; ok: boolean; output?: string; error?: string }> }>;
        removeWorktree: (cwd: string, path: string, force?: boolean) => Promise<IpcResult & { output?: string }>;
        pruneWorktrees: (cwd: string) => Promise<IpcResult & { output?: string }>;
        push: (cwd: string) => Promise<IpcResult & { output?: string }>;
        pull: (cwd: string) => Promise<IpcResult & { output?: string }>;
        fetch: (cwd: string) => Promise<IpcResult & { output?: string }>;
        diffFile: (cwd: string, file: string, staged: boolean) => Promise<{ diff?: string; error?: string }>;
        diffStat: (cwd: string) => Promise<{ additions: number; deletions: number }>;
        log: (cwd: string, count?: number) => Promise<GitLogEntry[] | { error: string }>;
        generateCommitMessage: (
          cwd: string,
          engine?: EngineId,
          sessionId?: string,
        ) => Promise<{ message?: string; error?: string }>;
      };
      terminal: {
        create: (options: { cwd?: string; cols?: number; rows?: number; sessionId?: string }) => Promise<{ terminalId?: string; error?: string }>;
        list: () => Promise<{
          terminals?: Array<{
            terminalId: string;
            sessionId: string;
            createdAt: number;
            exited: boolean;
            exitCode: number | null;
          }>;
          error?: string;
        }>;
        snapshot: (terminalId: string) => Promise<{
          output?: string;
          seq?: number;
          cols?: number;
          rows?: number;
          exited?: boolean;
          exitCode?: number | null;
          error?: string;
        }>;
        write: (terminalId: string, data: string) => Promise<IpcResult>;
        resize: (terminalId: string, cols: number, rows: number) => Promise<IpcResult>;
        destroy: (terminalId: string) => Promise<{ ok?: boolean }>;
        destroySession: (sessionId: string) => Promise<{ ok?: boolean }>;
        remapSession: (fromSessionId: string, toSessionId: string) => Promise<{ ok?: boolean }>;
        onData: (callback: (data: { terminalId: string; data: string; seq: number }) => void) => () => void;
        onExit: (callback: (data: { terminalId: string; exitCode: number }) => void) => () => void;
      };
      acp: {
        log: (label: string, data: unknown) => void;
        start: (options: { agentId: string; cwd: string; mcpServers?: McpServerConfig[] }) => Promise<ACPStartResult>;
        authenticate: (sessionId: string, methodId: string) => Promise<ACPAuthenticateResult>;
        prompt: (sessionId: string, text: string, images?: unknown[]) => Promise<IpcResult>;
        stop: (sessionId: string) => Promise<IpcResult>;
        reloadSession: (sessionId: string, mcpServers?: McpServerConfig[], cwd?: string) => Promise<IpcResult & { supportsLoad?: boolean }>;
        reviveSession: (options: { agentId: string; cwd: string; agentSessionId?: string; mcpServers?: McpServerConfig[] }) => Promise<{ sessionId?: string; agentSessionId?: string; usedLoad?: boolean; configOptions?: ACPConfigOption[]; mcpStatuses?: ACPStatusInfo[]; error?: string }>;
        cancel: (sessionId: string) => Promise<IpcResult>;
        abortPendingStart: () => Promise<{ ok?: boolean }>;
        respondPermission: (sessionId: string, requestId: string, optionId: string) => Promise<IpcResult>;
        setConfig: (sessionId: string, configId: string, value: string) => Promise<{ configOptions?: ACPConfigOption[]; error?: string }>;
        getConfigOptions: (sessionId: string) => Promise<{ configOptions?: ACPConfigOption[] }>;
        getAvailableCommands: (sessionId: string) => Promise<{ commands?: ACPAvailableCommand[] }>;
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
          Promise<IpcResult>;
        respondUserInput: (
          sessionId: string,
          rpcId: string | number,
          answers: Record<string, { answers: string[] }>,
        ) => Promise<IpcResult>;
        respondServerRequestError: (
          sessionId: string,
          rpcId: string | number,
          code: number,
          message: string,
        ) => Promise<IpcResult>;
        compact: (sessionId: string) => Promise<{ error?: string }>;
        listSkills: (sessionId: string) => Promise<{
          skills: SkillsListEntry[];
          error?: string;
        }>;
        listApps: (sessionId: string) => Promise<{
          apps: AppInfo[];
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
      mcp: {
        list: (projectId: string) => Promise<McpServerConfig[]>;
        add: (projectId: string, server: McpServerConfig) => Promise<IpcResult>;
        remove: (projectId: string, name: string) => Promise<IpcResult>;
        authenticate: (serverName: string, serverUrl: string) => Promise<IpcResult>;
        authStatus: (serverName: string) => Promise<{ hasToken: boolean; expiresAt?: number }>;
        probe: (servers: McpServerConfig[]) => Promise<Array<{ name: string; status: "connected" | "needs-auth" | "failed"; error?: string }>>;
      };
      agents: {
        list: () => Promise<InstalledAgent[]>;
        save: (agent: InstalledAgent) => Promise<IpcResult>;
        delete: (id: string) => Promise<IpcResult>;
        updateCachedConfig: (agentId: string, configOptions: ACPConfigOption[]) => Promise<{ ok?: boolean }>;
        /** Batch-check if binary-only agents are installed on the system PATH. */
        checkBinaries: (
          agents: Array<{ id: string; binary: Record<string, { cmd: string; args?: string[] }> }>,
        ) => Promise<Record<string, { path: string; args?: string[] } | null>>;
        /** Preferred ACP registry platform keys for the current machine. */
        getPlatformKeys: () => Promise<string[]>;
      };
      settings: {
        get: () => Promise<AppSettings>;
        set: (patch: Partial<AppSettings>) => Promise<IpcResult>;
        /** Subscribe to settings changes pushed from the main process. */
        onChanged: (callback: (settings: AppSettings) => void) => () => void;
      };
      jira: {
        getConfig: (projectId: string) => Promise<JiraProjectConfig | null>;
        saveConfig: (projectId: string, config: JiraProjectConfig) => Promise<IpcResult>;
        deleteConfig: (projectId: string) => Promise<IpcResult>;
        authenticate: (
          instanceUrl: string,
          method: "oauth" | "apitoken",
          apiToken?: string,
          email?: string
        ) => Promise<IpcResult>;
        authStatus: (instanceUrl: string) => Promise<{ hasToken: boolean }>;
        logout: (instanceUrl: string) => Promise<IpcResult>;
        getProjects: (instanceUrl: string) => Promise<JiraProjectSummary[] | { error: string }>;
        getBoards: (params: JiraGetBoardsParams) => Promise<JiraBoard[] | { error: string }>;
        getBoardConfiguration: (params: JiraGetSprintsParams) => Promise<JiraBoardConfiguration | { error: string }>;
        getSprints: (params: JiraGetSprintsParams) => Promise<JiraSprint[] | { error: string }>;
        getIssues: (params: JiraGetIssuesParams) => Promise<JiraIssue[] | { error: string }>;
        getComments: (params: JiraGetCommentsParams) => Promise<JiraComment[] | { error: string }>;
        getTransitions: (params: JiraGetTransitionsParams) => Promise<JiraTransition[] | { error: string }>;
        transitionIssue: (params: JiraTransitionIssueParams) => Promise<IpcResult>;
      };
      analytics: {
        /** Fire-and-forget analytics event via the main process PostHog client. */
        capture: (event: string, properties?: Record<string, unknown>) => void;
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
        isPreRelease: () => Promise<PreReleaseInfo>;
        onPreReleaseStatus: (cb: (info: PreReleaseInfo) => void) => () => void;
      };
    };
  }
}
