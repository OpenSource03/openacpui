// ── Protocol types (Claude CLI stream-json wire format) ──

export type {
  SystemInitEvent,
  SystemStatusEvent,
  SystemCompactBoundaryEvent,
  StreamEvent,
  MessageStartEvent,
  ContentBlockStartEvent,
  ContentBlockDeltaEvent,
  ContentBlockStopEvent,
  MessageDeltaEvent,
  MessageStopEvent,
  AssistantMessageEvent,
  AssistantMessageUsage,
  ContentBlock,
  ToolResultEvent,
  ToolUseResult,
  ResultEvent,
  ModelUsageEntry,
  TaskStartedEvent,
  TaskProgressEvent,
  TaskNotificationEvent,
  ToolProgressEvent,
  ClaudeEvent,
  AuthStatusEvent,
} from "./protocol";

// ── Session types ──

export type {
  ClaudeEffort,
  TodoItem,
  SubagentToolStep,
  UIMessage,
  SessionInfo,
  Project,
  ChatFolder,
  SessionBase,
  ChatSession,
  PersistedSession,
  CCSessionInfo,
} from "./session";

// ── Space types ──

export type {
  SpaceColor,
  Space,
} from "./spaces";

// ── Search types ──

export type {
  SearchMessageResult,
  SearchSessionResult,
} from "./search";

// ── Attachment types ──

export type {
  ImageAttachment,
  GrabbedElement,
} from "./attachments";

// ── Permission types ──

export type {
  PermissionUpdateDestination,
  PermissionRuleValue,
  PermissionUpdate,
  PermissionRequest,
  AcpPermissionBehavior,
} from "./permissions";

// ── Background agent types ──

export type {
  BackgroundAgentUsage,
  BackgroundAgent,
  BackgroundAgentActivity,
} from "./agents";

// ── MCP & model types ──

export type {
  ContextUsage,
  ModelInfo,
  McpTransport,
  McpServerConfig,
  McpServerStatusState,
  McpServerStatus,
} from "./mcp";

// ── Settings types (shared) ──

export type {
  PreferredEditor,
  VoiceDictationMode,
  ThemeOption,
  MacBackgroundEffect,
  CodexBinarySource,
  ClaudeBinarySource,
  NotificationTrigger,
  NotificationEventSettings,
  NotificationSettings,
  AppSettings,
} from "@shared/types/settings";

// ── Git types (shared) ──

export type {
  GitFileStatus,
  GitFileGroup,
  GitFileChange,
  GitBranch,
  GitRepoInfo,
  GitStatus,
  GitLogEntry,
} from "@shared/types/git";

// ── Registry types ──

export type {
  InstalledAgent,
  RegistryAgent,
  RegistryData,
  RegistryDistribution,
  RegistryNpxDistribution,
  RegistryBinaryTarget,
  BinaryCheckResult,
} from "./registry";

// ── ACP types ──

export type {
  ACPSessionEvent,
  ACPSessionUpdate,
  ACPAgentMessageChunk,
  ACPAgentThoughtChunk,
  ACPUserMessageChunk,
  ACPToolCall,
  ACPToolCallUpdate,
  ACPPlan,
  ACPUsageUpdate,
  ACPSessionInfoUpdate,
  ACPCurrentModeUpdate,
  ACPConfigOptionUpdate,
  ACPPermissionEvent,
  ACPTurnCompleteEvent,
  ACPConfigOption,
  ACPConfigSelectOption,
  ACPConfigSelectGroup,
  ACPAvailableCommand,
  ACPAvailableCommandsUpdate,
  ACPAuthEnvVar,
  ACPAuthMethodAgent,
  ACPAuthMethodEnvVar,
  ACPAuthMethodTerminal,
  ACPAuthMethod,
  ACPStatusInfo,
  ACPStartSuccessResult,
  ACPStartAuthRequiredResult,
  ACPStartErrorResult,
  ACPStartResult,
  ACPAuthenticateResult,
} from "./acp";

// ── Engine types ──

export type { EngineId, EngineHookState, AppPermissionBehavior, RespondPermissionFn, BackgroundSessionSnapshot, SlashCommand } from "./engine";

// ── Codex types ──

export type {
  CodexSessionEvent,
  CodexApprovalRequest,
  CodexRequestUserInputRequest,
  CodexServerRequest,
  CodexExitEvent,
  CodexAuthRequiredNotification,
  CodexTokenUsageNotification,
  CodexThreadItem,
} from "./codex";

// ── Tool types ──

export type { ToolId, PanelToolId, ToolDef } from "./tools";

// ── Tool islands types ──

export type {
  ToolIslandDock,
  ToolIsland,
  ToolColumn,
  TopRowItem,
  ToolIslandMemory,
  ToolDragState,
  PaneResizeController,
  TopColumnLocation,
} from "./tool-islands";

// ── Pane controller types ──

export type {
  PaneController,
  ToolIslandContextProps,
} from "./pane-controller";
