# Harnss

Open-source desktop client for the Agent Client Protocol. Uses the `@anthropic-ai/claude-agent-sdk` to programmatically manage Claude sessions via `query()`. Supports multiple concurrent sessions with persistent chat history, project workspaces, background agents, tool permissions, and context compaction.

## Tech Stack

- **Runtime**: Electron 40 (main process) + React 19 (renderer)
- **Build**: Vite 7, TypeScript 5.9, tsup (electron TS→JS)
- **Styling**: Tailwind CSS v4 + ShadCN UI (includes Preflight — no CSS resets needed)
- **UI Components**: ShadCN (Button, Badge, ScrollArea, Tooltip, Collapsible, Separator, DropdownMenu, Avatar)
- **Icons**: lucide-react
- **Markdown**: react-markdown + remark-gfm + react-syntax-highlighter + @tailwindcss/typography
- **Diff**: diff (word-level diff rendering)
- **Glass effect**: electron-liquid-glass (macOS Tahoe+ transparency)
- **SDK**: @anthropic-ai/claude-agent-sdk (ESM-only, async-imported from CommonJS)
- **Terminal**: node-pty (main process) + @xterm/xterm + @xterm/addon-fit (renderer)
- **Browser**: Electron `<webview>` tag (requires `webviewTag: true` in webPreferences)
- **Virtualization**: @tanstack/react-virtual (chat message windowing)
- **State management**: zustand (settings store, localStorage wrapper)
- **Animation**: motion (v12, formerly framer-motion)
- **Canvas/Annotations**: react-konva + konva (image annotation editor)
- **Diagrams**: mermaid (MermaidDiagram.tsx)
- **Code editor**: @monaco-editor/react (Monaco VS Code editor integration)
- **Voice**: @huggingface/transformers (Whisper speech-to-text, lazy-loaded)
- **Notifications**: sonner (toast notifications)
- **Package manager**: pnpm
- **Path aliases**: `@/` → `./src/`, `@shared/` → `./shared/`

## Project Structure

```
shared/
├── types/             # Types shared between electron and renderer processes
│   ├── codex-protocol/  # Auto-generated Codex protocol types (from codex app-server)
│   │   ├── v2/          # Modern v2 API types
│   │   └── serde_json/  # JSON value types
│   ├── codex.ts         # Codex type re-exports with Codex-prefixed aliases
│   ├── engine.ts        # EngineId, AppPermissionBehavior, SlashCommand, RespondPermissionFn
│   ├── acp.ts           # ACP session update types
│   ├── registry.ts      # Agent registry types
│   ├── git.ts           # Git operation types (GitFileStatus, GitBranch, GitRepoInfo, etc.)
│   ├── jira.ts          # Jira integration types (JiraProjectConfig, JiraBoard, JiraIssue, etc.)
│   └── settings.ts      # AppSettings type definition
└── lib/               # Shared utilities usable by both processes
    ├── acp-helpers.ts         # ACP helper functions
    ├── async-channel.ts       # AsyncChannel implementation
    ├── codex-helpers.ts       # Codex helper functions
    ├── codex-rpc.ts           # Codex RPC protocol helpers
    ├── error-utils.ts         # Shared error extraction utilities
    ├── mcp-config.ts          # MCP configuration parsing
    └── session-persistence.ts # Session serialization logic

electron/
├── dist/       # tsup build output (gitignored)
└── src/
    ├── ipc/    # IPC handlers (claude-sessions, acp-sessions, codex-sessions, projects, sessions,
    │           #              settings, terminal, git, jira, mcp, spaces, files, folders, cc-import, title-gen)
    └── lib/    # Main-process utilities (logger, async-channel, data-dir, app-settings, sdk,
                #   error-utils, git-exec, jira-client, jira-store, jira-oauth-store, mcp-store,
                #   mcp-oauth-flow, mcp-oauth-provider, mcp-oauth-store, acp-auth, claude-binary,
                #   codex-binary, codex-rpc, migration, posthog, updater, glass, terminal-history, etc.)

src/
├── components/
│   ├── git/           # GitPanel decomposed (GitPanel, RepoSection, BranchPicker, CommitInput, etc.)
│   ├── browser/       # BrowserPanel decomposed (BrowserNavBar, BrowserUrlBar, WebviewInstance, etc.)
│   ├── input-bar/     # InputBar decomposed (CommandPicker, MentionPicker, EngineControls, etc.)
│   ├── jira/          # Jira board UI (KanbanBoard, JiraIssueCard, JiraBoardSetup)
│   ├── mcp/           # MCP server management UI (AddServerDialog, McpServerRow, McpAuthStatus)
│   ├── mcp-renderers/ # MCP tool renderers (jira, confluence, atlassian, context7, shared, helpers)
│   ├── tool-renderers/# Built-in tool renderers (BashContent, EditContent, TaskTool, etc.)
│   ├── settings/      # Settings sub-views + shared SettingRow/SettingsSelect (12 panels)
│   ├── sidebar/       # AppSidebar decomposed (ProjectSection, FolderSection, BranchSection,
│   │                  #   PinnedSection, SessionItem, CCSessionList, SidebarActionsContext)
│   ├── split/         # Split pane layout (SplitPaneHost, SplitChatPane, SplitHandle, etc.)
│   ├── welcome/       # Onboarding wizard (WelcomeWizard, 9 step components)
│   ├── workspace/     # Workspace layout (MainTopToolArea, MainBottomToolDock, RightPanel, ToolIslandContent)
│   ├── lib/           # Component-local utilities (tool-metadata, tool-formatting, ToolGlyph, chat-layout)
│   └── ui/            # ShadCN base components (auto-generated)
├── hooks/
│   ├── session/       # useSessionManager decomposed (lifecycle, persistence, draft, revival, queue,
│   │                  #   cache, crud, pane, restart, settings, extra-pane-loader)
│   ├── app-layout/    # useAppOrchestrator decomposed (useAppLayoutUIState, useAppSessionActions,
│   │                  #   useAppContextualPanels, useAppEnvironmentState, useAppSpaceWorkflow)
│   └── ...            # React hooks (useEngineBase, useClaude, useACP, useCodex, useSpaceManager,
│                      #   useGitStatus, useWorktreeChips, useJiraBoard, useSpeechRecognition,
│                      #   useSpaceTerminals, useToolIslands, useSplitView, useNotifications, etc.)
├── lib/               # Renderer utilities organized in subdirectories:
│   ├── analytics/     #   analytics.ts, posthog.ts
│   ├── background/    #   session-store.ts, claude/acp/codex-handler.ts, agent-store.ts
│   ├── chat/          #   scroll.ts, virtualization.ts, thinking-animation.ts, todo-utils.ts, etc.
│   ├── diff/          #   diff-stats.ts, patch-utils.ts, unified-diff.ts
│   ├── engine/        #   protocol.ts, streaming-buffer.ts, acp-adapter.ts, codex-adapter.ts,
│   │                  #   acp-utils.ts, permission-queue.ts, acp-agent-registry.ts, etc.
│   ├── git/           #   discover-repos-cache.ts
│   ├── layout/        #   constants.ts, split-layout.ts, split-view-state.ts, workspace-constraints.ts
│   ├── session/       #   derived-data.ts, records.ts, space-projects.ts
│   ├── sidebar/       #   dnd.ts (drag/drop), grouping.ts (session grouping)
│   ├── workspace/     #   tool-docking.ts, tool-groups.ts, tool-island-utils.ts, main-tool-widths.ts
│   └── ...            # Root utilities: message-factory.ts, file-access.ts, mcp-utils.ts,
│                      #   color-utils.ts, icon-utils.ts, jira-utils.ts, model-utils.ts,
│                      #   notification-utils.ts, session-notifications.ts, ansi.tsx, etc.
├── stores/            # Zustand stores (settings-store.ts — localStorage wrapper)
└── types/             # Renderer-side types (protocol, ui, session, spaces, attachments, tools,
                       #   mcp, permissions, search, tool-islands, window.d.ts) + re-export shims for shared/
```

## How to Run

```bash
pnpm install
pnpm dev       # Starts Vite dev server + tsup watch + Electron
pnpm build     # tsup (electron/) + Vite (renderer) production build
pnpm start     # Run Electron with pre-built dist/
```

**Dev logs**: Main process logs go to `logs/main-{timestamp}.log` (dev) or `{userData}/logs/main-{timestamp}.log` (packaged). Check the latest file with `ls -t logs/main-*.log | head -1 | xargs cat`.

## Architecture

### SDK-Based Session Management

The main process uses `@anthropic-ai/claude-agent-sdk` (ESM-only, loaded via `await import()`). Each session runs a long-lived SDK `query()` with an `AsyncChannel` for multi-turn input.

**Session Map**: `Map<sessionId, { channel, queryHandle, eventCounter, pendingPermissions }>`

- `channel` — AsyncChannel (push-based async iterable) for sending user messages to SDK
- `queryHandle` — SDK query handle for interrupt/close/setPermissionMode
- `pendingPermissions` — Map<requestId, { resolve }> for bridging SDK permission callbacks to UI

**IPC API — Claude Sessions:**

- `claude:start(options)` → spawns SDK query with AsyncChannel, returns `{ sessionId, pid }`
  - Options: `cwd`, `model`, `permissionMode`, `resume` (session continuation)
  - Configures `canUseTool` callback for permission bridging
  - Thinking: `{ type: "enabled", budgetTokens: 16000 }`
- `claude:send({ sessionId, message })` → pushes user message to session's AsyncChannel
- `claude:stop(sessionId)` → closes channel + query handle, removes from Map
- `claude:interrupt(sessionId)` → denies all pending permissions, calls `queryHandle.interrupt()`
- `claude:permission_response(sessionId, requestId, ...)` → resolves pending permission Promise
- `claude:set-permission-mode(sessionId, mode)` → calls `queryHandle.setPermissionMode()`
- `claude:generate-title(message, cwd?)` → one-shot Haiku query for chat title
- Events sent to renderer via `claude:event` tagged with `_sessionId`
- Permission requests sent via `claude:permission_request` with requestId

**IPC API — Projects:**

- `projects:list` / `projects:create` / `projects:delete` / `projects:rename`

**IPC API — Session Persistence:**

- `sessions:save(data)` — writes to `{userData}/openacpui-data/sessions/{projectId}/{id}.json` (`openacpui-data` kept for backward compatibility)
- `sessions:load(projectId, id)` — reads session file
- `sessions:list(projectId)` — returns session metadata sorted by date
- `sessions:delete(projectId, id)` — removes session file

**IPC API — Claude Code Import:**

- `cc-sessions:list(projectPath)` — lists JSONL files in `~/.claude/projects/{hash}`
- `cc-sessions:import(projectPath, ccSessionId)` — converts JSONL transcript to UIMessage[]

**IPC API — File Operations:**

- `files:list(cwd)` — git ls-files respecting .gitignore, returns `{ files, dirs }`
- `files:read-multiple(cwd, paths)` — batch read with path validation and size limits
- `file:read(filePath)` — single file read (used for diff context)
- `file:open-in-editor({ filePath, line? })` — opens file in external editor (tries cursor, code, zed CLIs with `--goto`, falls back to OS default)

**IPC API — Terminal (PTY):**

- `terminal:create({ cwd, cols, rows })` → spawns shell via node-pty, returns `{ terminalId }`
- `terminal:write({ terminalId, data })` → sends keystrokes to PTY
- `terminal:resize({ terminalId, cols, rows })` → resizes PTY dimensions
- `terminal:destroy(terminalId)` → kills the PTY process
- Events: `terminal:data` (PTY output), `terminal:exit` (process exit)

**IPC API — App Settings:**

- `settings:get` — returns full `AppSettings` object (JSON file in data dir)
- `settings:set(patch)` — merges partial update, persists to disk, notifies in-process listeners

**IPC API — Git:**

- `git:status(cwd)` — returns `GitStatus` (branch, ahead/behind, staged/unstaged changes)
- `git:log(cwd, limit?)` — recent commit log entries
- `git:diff(cwd, filePath?)` — staged or file-level diff
- `git:stage(cwd, paths)` / `git:unstage(cwd, paths)` — staging area management
- `git:commit(cwd, message)` — create commit
- `git:branches(cwd)` — list local + remote branches
- `git:checkout(cwd, branch)` — switch branches (or create with `-b`)
- `git:worktrees(cwd)` — list git worktrees
- `git:add-worktree(cwd, branch, path)` / `git:remove-worktree(cwd, path)` — worktree management
- `git:generate-commit-message(cwd)` — one-shot SDK query to generate a commit message from staged diff

**IPC API — MCP Servers:**

- `mcp:list` — returns all configured MCP servers
- `mcp:add(config)` / `mcp:remove(name)` / `mcp:update(name, config)` — CRUD for MCP server configs
- `mcp:oauth-start(serverName)` — initiates OAuth flow for MCP server, opens browser
- `mcp:oauth-callback(code, state)` — handles OAuth redirect callback
- `mcp:get-auth-status(serverName)` — returns OAuth token status

**IPC API — Spaces:**

- `spaces:list` / `spaces:create(config)` / `spaces:delete(id)` / `spaces:update(id, patch)` — Space CRUD
- Each space has `{ id, name, color, icon, projectId, worktreePath? }`

**IPC API — Jira:**

- `jira:get-config` — returns stored Jira OAuth config and selected board
- `jira:set-config(config)` — saves Jira connection settings
- `jira:oauth-start` — opens browser for Jira OAuth flow
- `jira:get-boards` — lists accessible Jira boards
- `jira:get-board(boardId)` — fetches issues for a board (columns, sprints, issues)
- `jira:update-issue(issueKey, fields)` — update issue status/assignee/etc.

**IPC API — Folders:**

- `folders:list(path)` — lists subdirectories for folder picker

### Settings Architecture

Three tiers of settings storage, each suited to different access patterns:

1. **`useSettings` hook** (renderer, localStorage) — UI preferences that only the renderer needs: model, permissionMode, panel widths, active tools, thinking toggle. Per-project settings keyed by `harnss-{projectId}-*`, global settings keyed by `harnss-*`.

2. **`settings-store.ts`** (renderer, Zustand + localStorage) — A thin Zustand wrapper around localStorage for settings that multiple components subscribe to reactively (e.g. theme, notification preferences). Located in `src/stores/settings-store.ts`. Prefer this over raw `localStorage` reads in components.

3. **`AppSettings` store** (main process, JSON file) — settings that the main process needs at startup before any BrowserWindow exists (e.g. `autoUpdater.allowPrerelease`, binary paths, analytics opt-in). File location: `{userData}/openacpui-data/settings.json` (`openacpui-data` kept for backward compatibility). Accessed via `getAppSettings()`/`setAppSettings()` in `electron/src/lib/app-settings.ts`. The `settings` IPC module exposes `settings:get`/`settings:set` to the renderer and fires `onSettingsChanged` listeners for in-process consumers (e.g. the updater). Type defined in `shared/types/settings.ts`.

**When to use which:** Use `useSettings`/`settings-store` for renderer-only preferences. Use `AppSettings` when the main process must read the value synchronously at startup or react to changes (e.g. updater config, binary management, window behavior).

### State Architecture

**Hook composition** — large hooks are decomposed into focused sub-hooks:

- `useAppOrchestrator` — wires together all top-level state (session manager, project manager, space manager, settings, agents, notifications) and provides ~30 callbacks to `AppLayout`. Itself decomposed in `hooks/app-layout/`:
  - `useAppLayoutUIState` — modal/panel open states
  - `useAppSessionActions` — session action callbacks (send, stop, interrupt)
  - `useAppContextualPanels` — which panels are visible based on active session
  - `useAppEnvironmentState` — environment checks, update banner, prerelease detection
  - `useAppSpaceWorkflow` — space switching, worktree selection, space creation flow
- `useSessionManager` — slim orchestrator (~400 lines) composing 5 sub-hooks:
  - `useSessionLifecycle` — session CRUD (create, switch, delete, rename, deselect)
  - `useSessionPersistence` — auto-save with debounce, background store seeding/consuming
  - `useDraftMaterialization` — draft-to-live session transitions for all 3 engines
  - `useSessionRevival` — per-engine revival (reconnecting to existing sessions)
  - `useMessageQueue` — message queuing and drain for not-yet-ready sessions
- `useEngineBase` — shared foundation for all engine hooks (state, rAF flush, reset effect)
- `useClaude` / `useACP` / `useCodex` — engine-specific event handling built on `useEngineBase`
- `useSpaceTheme` — space color tinting via CSS custom properties
- `useSpaceManager` — space CRUD (create, delete, rename, reorder, worktree assignment)
- `usePanelResize` / `useToolColumnResize` / `useMainToolAreaResize` — resize handle logic
- `useToolIslands` / `useToolDragDrop` / `useSplitView` — tool panel docking and split layout
- `useStreamingTextReveal` — per-token fade-in animation via DOM text node splitting
- `useProjectManager` — project CRUD via IPC
- `useFolderManager` — folder picker for project path selection
- `useBackgroundAgents` — polls async Task agent output files every 3s, marks complete after 2 stable polls
- `useSidebar` — sidebar open/close with localStorage persistence
- `useGitStatus` — polls git status for the active project's cwd
- `useWorktreeChips` — derives available worktrees for the WorktreeBar
- `useJiraBoard` / `useJiraBoardData` / `useJiraConfig` — Jira board management
- `useSpeechRecognition` — voice dictation via Whisper (lazy-loads `@huggingface/transformers`) or native OS speech API
- `useSpaceTerminals` — tracks which terminal tabs belong to which space
- `useNotifications` — OS notification triggers based on session completion events
- `useKeyboardShortcuts` — global keybinding registration
- `useAgentRegistry` / `useAgentStore` / `useAcpAgentAutoUpdate` — agent registry sync

**BackgroundSessionStore** — accumulates events for non-active sessions to prevent state loss when switching. On switch-away, session state is captured into the store; on switch-back, state is consumed from the store (or loaded from disk if no live process). Event handling is split into per-engine handler modules (`background-claude-handler.ts`, `background-acp-handler.ts`, `background-codex-handler.ts`).

### Claude CLI Stream-JSON Protocol

Key event types in order:

- `system` (init) — session metadata, model, tools, permissionMode, version
- `system` (status) — status updates
- `system` (compact_boundary) — context compaction marker
- `stream_event` wrapping: `message_start` → `content_block_start` → `content_block_delta` (repeated) → `content_block_stop` → `message_delta` → `message_stop`
- `assistant` — complete message snapshot (with `includePartialMessages`, sent after thinking and after text)
- `user` (tool_result) — tool execution results with `tool_use_result` metadata
- `result` — turn complete with cost/duration/modelUsage

### Key Patterns

**rAF streaming flush**: React 19 batches rapid `setState` calls into a single render. When SDK events arrive in a tight loop, all IPC-fired `setState` calls merge into one render → text appears all at once. Fix: accumulate deltas in `StreamingBuffer` (refs), schedule a single `requestAnimationFrame` to flush to React state at ~60fps.

**Subagent routing via `parent_tool_use_id`**: Events from Task subagents have `parent_tool_use_id` set to the Task tool_use block's `id`. A `parentToolMap` (Map<string, string>) maps this ID to the tool_call message ID in the UI, allowing subagent activity to be routed to the correct Task card with `subagentSteps`.

**Thinking with `includePartialMessages`**: Two `assistant` events per turn — first contains only thinking blocks, second contains only text blocks. The hook merges both into the same streaming message.

**Permission bridging**: SDK's async `canUseTool` callback creates a Promise stored in `pendingPermissions` Map. Main process sends `claude:permission_request` to renderer. UI shows `PermissionPrompt`. User decision sent back via `claude:permission_response`, resolving the stored Promise to allow/deny the tool.

**Background session store**: When switching sessions, the active session's state (messages, processing flag, sessionInfo, cost) is captured into `BackgroundSessionStore`. Events for non-active sessions route to the store instead of React state. On switch-back, state is consumed from the store to restore the UI instantly.

**Glass morphism**: On macOS Tahoe+, uses `electron-liquid-glass` for native transparency. DevTools opened via remote debugging on a separate window to avoid Electron bug #42846 (transparent + frameless + DevTools = broken clicks).

### Tools Panel System

The right side of the layout has a **ToolPicker** strip (vertical icon bar, always visible) that toggles tool panels on/off. Active tools state (`Set<ToolId>`) is persisted to localStorage.

**Layout**: `Sidebar | Chat | Tasks/Agents | [Tool Panels] | ToolPicker`

Tool panels share a resizable column. When multiple tools are active, they split vertically with a draggable divider (ratio persisted to localStorage, clamped 20%–80%). The column width is also resizable (280–800px).

**Terminal** (`ToolsPanel`): Multi-tab xterm.js instances. Each tab spawns a node-pty process in the main process via IPC. Uses `allowTransparency: true` + `background: "#00000000"` for transparent canvas that inherits the island's `bg-background`. The FitAddon + ResizeObserver auto-sizes the terminal on panel resize.

**Browser** (`BrowserPanel`): Multi-tab Electron `<webview>` with URL bar, back/forward/reload, HTTPS indicator. Smart URL input: bare domains get `https://` prefix, non-URL text becomes a Google search.

**Open Files** (`FilesPanel`): Derives accessed files from the session's `UIMessage[]` array — no IPC needed. Scans `tool_call` messages for `Read`/`Edit`/`Write`/`NotebookEdit` tools + subagent steps. Tracks per-file access type (read/modified/created), deduplicates by path keeping highest access level, sorts by most recently accessed. Clicking a file scrolls to its last tool_call in chat.

### MCP Tool Rendering System

MCP tool calls are rendered with rich, tool-specific UIs via `McpToolContent.tsx`. The system supports both SDK sessions (`mcp__Server__tool`) and ACP sessions (`Tool: Server/tool`).

**Detection**: `ToolCall.tsx` detects MCP tools by checking if `toolName` starts with `"mcp__"` or `"Tool: "`, then delegates to `<McpToolContent>`.

**Registry** (`McpToolContent.tsx`): Two-tier lookup:
1. **Exact match map** — `MCP_RENDERERS: Map<string, Component>` keyed by canonical tool suffix (e.g., `"searchJiraIssuesUsingJql"`)
2. **Pattern match array** — `MCP_RENDERER_PATTERNS: Array<{ pattern: RegExp, component }>` using `[/_]+` character class to match both `__` (SDK) and `/` (ACP) separators

Tool name normalization: `extractMcpToolName(toolName)` strips the `"mcp__Server__"` or `"Tool: Server/"` prefix to get the base tool name for registry lookup.

**Data extraction**: `extractMcpData(toolResult)` handles both SDK and ACP response shapes:
- SDK: `toolResult.content` (string or `[{ type: "text", text }]` array)
- ACP: flat objects with `{ key, fields, renderedFields }` (no wrapper)
- Atlassian wraps Jira responses in `{ issues: { totalCount, nodes: [...] } }` — use `unwrapJiraIssues()` to normalize

**Adding a new MCP tool renderer**:
1. Create a component in `src/components/mcp-renderers/` that accepts `{ data: unknown }`
2. Register in `MCP_RENDERERS` (exact name) and/or `MCP_RENDERER_PATTERNS` (regex with `[/_]+`) in `McpToolContent.tsx`
3. Also add to `getMcpCompactSummary()` for collapsed tool card summaries

**Tool naming conventions**:
- SDK engine: `mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql`
- ACP engine: `Tool: Atlassian/searchJiraIssuesUsingJql`
- All regex patterns use `Atlassian[/_]+` to match both
- Label/formatting logic in `src/components/lib/tool-metadata.ts` (`getMcpToolLabel`, `MCP_TOOL_LABELS`) handles both prefixes
- Compact summaries in `src/components/lib/tool-formatting.ts` (`formatCompactSummary`)

**Text-based tools**: Some MCP tools (e.g., Context7) return plain text/markdown instead of JSON. `extractMcpText()` extracts the raw text, passed to renderers as `rawText` prop alongside `data` (which will be `null` for non-JSON responses). Text-based renderers should parse the `rawText` string themselves.

**Existing renderers** (in `src/components/mcp-renderers/`):
- `jira.tsx` — `JiraIssueList` (search), `JiraIssueDetail` (getJiraIssue/fetch), `JiraProjectList`, `JiraTransitions`
- `confluence.tsx` — `ConfluenceSearchResults`, `ConfluenceSpaces`
- `atlassian.tsx` — `RovoSearchResults`, `RovoFetchResult`, `AtlassianResourcesList`
- `context7.tsx` — `Context7LibraryList` (resolve-library-id), `Context7DocsResult` (query-docs)

### Git Integration

`ipc/git.ts` exposes a full git operation layer backed by `electron/src/lib/git-exec.ts`. Status, log, diff, stage/unstage, commit, branch operations, and worktree management are all available via IPC (see IPC API — Git section above).

**Worktrees**: `WorktreeBar.tsx` shows available git worktrees for the active project and lets the user switch. `useWorktreeChips` derives the chip list from `git:worktrees`. Each `Space` can be pinned to a worktree path; `useAppSpaceWorkflow` handles the worktree-space association. Worktree config is stored in `.harnss/worktree.json`.

**Git Panel** (`src/components/git/`): Decomposed into 9 components — `GitPanel` (orchestrator), `RepoSection` (repo header + branch), `BranchPicker` (branch switcher popover), `ChangesSection` (staged/unstaged file list), `CommitInput` (message + commit button), `FileItem` (individual file row), `InlineDiff` (per-file diff preview), `InlineSelector` (hunk-level staging UI), `git-panel-utils.ts` (formatting helpers).

**Commit message generation**: `oneShotSdkQuery()` calls a one-shot Claude Haiku query with the staged diff to generate a commit message. Exposed as `git:generate-commit-message(cwd)`.

### Jira Integration

Full Jira board integration via OAuth 2.0 (3-legged flow):

- **OAuth**: `electron/src/lib/acp-auth.ts`-style flow via `electron/src/lib/jira-oauth-store.ts`. User authenticates in browser, loopback redirect captured by Electron. Token stored in `jira-oauth-store.ts`.
- **Board data**: `electron/src/lib/jira-client.ts` wraps the Jira REST API. `ipc/jira.ts` exposes board/issue operations.
- **UI**: `JiraBoardPanel.tsx` hosts the board. `src/components/jira/` contains `KanbanBoard.tsx` (column layout with drag-and-drop), `JiraIssueCard.tsx` (compact card), `JiraBoardSetup.tsx` (initial OAuth + board selection). `JiraIssuePreviewOverlay.tsx` shows issue details without leaving the board.
- **Types**: `shared/types/jira.ts` defines all Jira entities.
- **Hooks**: `useJiraConfig` (stored config), `useJiraBoardData` (fetch + poll), `useJiraBoard` (full board state + actions).

### MCP Server Management

Users can add/remove/configure MCP servers from Settings → MCP. MCP servers can require OAuth for access:

- **Storage**: `electron/src/lib/mcp-store.ts` — server config (name, command, args, env). `electron/src/lib/mcp-oauth-store.ts` — token storage.
- **OAuth**: `electron/src/lib/mcp-oauth-flow.ts` + `mcp-oauth-provider.ts` — runs a local loopback HTTP server to capture the OAuth redirect, then exchanges for tokens.
- **UI**: `src/components/mcp/` — `AddServerDialog.tsx` (server config form), `McpServerRow.tsx` (server list item with auth status), `McpAuthStatus.tsx` (OAuth connection state indicator). `McpPanel.tsx` shows the MCP status panel in tools.

### Voice Dictation

`useSpeechRecognition.ts` provides voice-to-text for the input bar:
- Tries native OS speech recognition first (Web Speech API)
- Falls back to Whisper via `@huggingface/transformers` (lazy-loaded only when activated — Whisper model is downloaded on first use)
- Result text is inserted into the active input bar

### Image Annotations

`ImageAnnotationEditor.tsx` and `ImageAnnotationToolbar.tsx` provide a Konva-based canvas annotation layer over attached images:
- Draw arrows, rectangles, text labels on screenshots before sending to Claude
- History tracked via `useAnnotationHistory` (undo/redo)
- `ImageLightbox.tsx` provides full-screen image viewing with zoom
- `FilePreviewOverlay.tsx` wraps file attachments in a preview modal

### Chat Search

`ChatSearchBar.tsx` provides in-session message search. Triggered by keyboard shortcut. Highlights matching messages and scrolls to them within the virtualized list.

### Todo Panel

`TodoPanel.tsx` extracts and displays `TodoWrite` tool call items from the active session's chat history. `src/lib/chat/todo-utils.ts` handles the extraction. Displayed as a separate tool panel accessible from the ToolPicker strip.

### Space Customization

Each Space can have a custom color and icon. `SpaceCustomizer.tsx` provides the UI. `ColorPicker.tsx` shows a palette of curated colors. `IconPicker.tsx` shows emoji/icon options. Color is applied as a CSS custom property via `useSpaceTheme` for subtle tinting of the workspace. `src/lib/color-utils.ts` handles color generation from agent icon URLs.

### Welcome Wizard

`src/components/welcome/WelcomeWizard.tsx` is a multi-step onboarding flow shown on first launch:
- Steps: Welcome → Agents → Appearance → Feature Tour → Permissions → Project → Ready (+ more)
- Step state tracked in localStorage via `src/lib/welcome-screen.ts`
- Arrow canvas animation drawn via `src/lib/welcome-screen-arrow.ts`

### Notification System

`src/lib/notification-utils.ts` triggers OS notifications (via Electron's `Notification` API) when sessions complete or produce output while unfocused. Settings control trigger mode: `always`, `unfocused` (default), or `never`. `src/lib/session-notifications.ts` maps session result events to notification calls. `useNotifications` hook wires this to the active session state.

### Split Pane Layout

`src/components/split/` implements a dual-pane chat layout (two sessions side by side):
- `SplitPaneHost.tsx` — container that renders two `SplitChatPane` instances
- `SplitHandle.tsx` — draggable divider between panes
- `SplitDropZone.tsx` — drag target for dropping sessions into a pane
- `SplitChatPane.tsx` — single pane with its own session, tools, and input
- `useSplitView` — manages split state (which sessions are in which pane, layout ratio)
- `useSplitDragDrop` — drag-and-drop session assignment to panes
- Layout math in `src/lib/layout/split-layout.ts`

### Binary Management

Claude CLI and Codex binaries can be managed downloads or user-provided custom paths:
- `electron/src/lib/claude-binary.ts` — detects Claude CLI binary: checks `AppSettings.claudeBinaryPath` first, then standard install locations, then managed download path
- `electron/src/lib/codex-binary.ts` — same pattern for Codex binary
- Users can configure custom binary paths in Settings → Advanced
- `prerelease-check.ts` — detects if the current build is a pre-release; `PreReleaseBanner.tsx` shows a dismissible banner in the UI

## Reference Documentation

When working on engine-related code, always consult these local docs:

- **Claude Agent SDK (Anthropic engine)**: `docs/ai-sdk/` — covers `query()`, MCP config, permissions, streaming, session management, subagents, etc.
- **ACP TypeScript SDK**: `docs/typescript-sdk-main/` — the `@anthropic-ai/agent-client-protocol` package, ACP client/server types, transport
- **Agent Client Protocol spec**: `docs/agent-client-protocol-main/` — ACP protocol spec, schema definitions, event types

Always search the web when needed for up-to-date API references, Electron APIs, or third-party package docs.

## Release Conventions

**Title format**: `v{X.Y.Z} — Short descriptive phrase` (e.g., `v0.8.0 — Git Worktrees, ACP Utility Sessions & Streaming Polish`)

**Release notes format**:
- Start with `## What's New` (for feature releases) or `## Changes` (for smaller releases)
- Group changes under `### Emoji Section Title` headers (e.g., `### 🌳 Git Worktree Management`)
- End with `---` separator and `**Full Changelog**: https://github.com/OpenSource03/harnss/compare/v{prev}...v{current}`
- Use `gh release create` with tag, then `gh release edit` to set title + notes
- **Write for users, not developers** — describe what the user *experiences*, never mention internal names, library names, or implementation details. "Long conversations are dramatically faster" not "replaced content-visibility with @tanstack/react-virtual". Full guidance in `.claude/skills/release/references/release-notes-template.md`.

**Commit message format** (conventional commits):
- `feat: short description` — new features
- `fix: short description` — bug fixes
- `chore: short description` — maintenance (version bumps, dep updates, CI)
- First line: imperative, lowercase, no period, under ~72 chars
- Body (optional): blank line after subject, then explain **why** not what, wrap at ~80 chars
- Examples from repo: `feat: git worktree management, ACP utility sessions, and streaming UI overhaul`, `fix: build both mac arches in one job to prevent latest-mac.yml race`

**Version bumping**:
1. Check for latest `@anthropic-ai/claude-agent-sdk` version and update in `package.json` if newer
2. Bump `version` in `package.json` (electron-builder uses this, NOT the git tag)
3. Commit: `chore: bump version to X.Y.Z`
4. Tag: `git tag vX.Y.Z HEAD && git push origin vX.Y.Z`
5. Create release: `gh release create vX.Y.Z --title "..." --notes "..."`

## Shared Types Architecture

Types shared between electron and renderer live in `shared/types/`. Both tsconfigs include this directory via `@shared/*` path alias.

- **`shared/types/codex-protocol/`** — auto-generated from `codex app-server generate-ts`. Contains v1, v2, and serde_json type families. Used by both electron Codex handlers and renderer hooks.
- **`shared/types/codex.ts`** — re-exports with `Codex`-prefixed aliases (e.g., `CodexThreadItem`, `CodexSessionEvent`) plus Harnss-specific wrappers (`CodexApprovalRequest`, `CodexRequestUserInputRequest`).
- **`shared/types/engine.ts`** — `EngineId`, `AppPermissionBehavior`, `SlashCommand`, `RespondPermissionFn`. No React or renderer dependencies.
- **`src/types/engine-hook.ts`** — `EngineHookState`, `BackgroundSessionSnapshot`. React-dependent engine types that live in the renderer layer.
- **`shared/types/acp.ts`** — ACP session update discriminated union types.
- **`shared/types/registry.ts`** — agent registry types (`RegistryAgent`, `RegistryData`).
- **`shared/types/git.ts`** — git operation types: `GitFileStatus`, `GitBranch`, `GitRepoInfo`, `GitStatus`, `GitLogEntry`, `GitWorktree`.
- **`shared/types/jira.ts`** — Jira integration types: `JiraProjectConfig`, `JiraBoard`, `JiraIssue`, `JiraColumn`, `JiraSprint`.
- **`shared/types/settings.ts`** — `AppSettings` type (notification config, editor/binary preferences, analytics settings, pre-release channel).

**Shared utilities** (`shared/lib/`) — utilities safe to import from both processes (no Electron or React imports):
- `async-channel.ts` — `AsyncChannel` push-based async iterable
- `session-persistence.ts` — session serialization/deserialization logic
- `mcp-config.ts` — MCP configuration schema parsing
- `codex-rpc.ts` — Codex RPC protocol helpers
- `error-utils.ts` — `extractErrorMessage()` without PostHog dependency
- `acp-helpers.ts` / `codex-helpers.ts` — event normalization helpers

**Backward compatibility**: `src/types/` contains re-export shims (`export * from "../../shared/types/..."`) so existing `@/types/*` imports continue to work. New code can use either `@/types/` or `@shared/types/`.

**Key type naming**:
- `InstalledAgent` (was `AgentDefinition` — renamed to avoid SDK clash)
- `AppPermissionBehavior` (was `PermissionBehavior` — renamed to avoid SDK clash)
- `SessionBase` — shared base for `ChatSession` and `PersistedSession`
- `BackgroundSessionSnapshot` — `{ isProcessing, isConnected, sessionInfo, totalCost }` snapshot for background store

**Electron SDK types**: `electron/src/lib/sdk.ts` imports `Query` and `query` types directly from `@anthropic-ai/claude-agent-sdk` (no more manual type definitions or double-casts). ACP connection is typed as `ClientSideConnection` from `@agentclientprotocol/sdk`.

**Note on `AsyncChannel`**: The canonical implementation lives in `shared/lib/async-channel.ts` and is imported by both `electron/src/ipc/claude-sessions.ts` and renderer-side code. Do not duplicate it.

### Shared Utilities

`src/lib/` is organized into subdirectories. Key utilities:

- **`src/lib/message-factory.ts`** — `createSystemMessage()`, `createUserMessage()`, `formatResultError()` — replaces 20+ inline UIMessage constructions
- **`src/lib/engine/streaming-buffer.ts`** — `StreamingBuffer` (Claude) + `SimpleStreamingBuffer` (ACP/Codex, merged from two identical copies)
- **`src/lib/engine/protocol.ts`** — event normalization from raw SDK events to `UIMessage[]`
- **`src/lib/engine/permission-queue.ts`** — permission request batching/deduplication
- **`src/lib/file-access.ts`** — pure data transformation for file access tracking (extracted from FilesPanel)
- **`src/lib/mcp-utils.ts`** — `toMcpStatusState()` (moved from types/ui.ts)
- **`src/lib/color-utils.ts`** — space color generation from agent icon URLs
- **`src/lib/icon-utils.ts`** — agent icon URL resolution
- **`src/lib/jira-utils.ts`** — Jira formatting helpers (issue key, priority icons, etc.)
- **`src/lib/model-utils.ts`** — model name parsing and display normalization
- **`src/lib/notification-utils.ts`** — OS notification trigger logic (respects `notifyOn: always/unfocused/never`)
- **`src/lib/session-notifications.ts`** — maps session events to notification triggers
- **`src/lib/session/records.ts`** — `UIMessage` and `ChatSession` type guards
- **`src/lib/session/derived-data.ts`** — computed session stats (token counts, cost summaries)
- **`src/lib/sidebar/grouping.ts`** — groups sessions by date/project for sidebar rendering
- **`src/lib/sidebar/dnd.ts`** — drag-and-drop logic for sidebar session reordering
- **`src/lib/workspace/tool-docking.ts`** — tool panel docking state (which tools are docked where)
- **`src/lib/workspace/tool-groups.ts`** — tool panel grouping for split layout
- **`src/lib/layout/split-layout.ts`** — split pane math (pixel ↔ ratio conversions)
- **`src/lib/chat/todo-utils.ts`** — extracts TodoWrite items from chat messages
- **`src/lib/chat/thinking-animation.ts`** — thinking block pulse animation logic
- **`src/lib/diff/patch-utils.ts`** — unified diff parsing and context extraction
- **`src/lib/git/discover-repos-cache.ts`** — caches git repo discovery results for the folder picker
- **`src/lib/analytics/analytics.ts`** — `capture()`, `captureException()`, `reportError()` — renderer-side analytics and error tracking
- **`src/lib/analytics/posthog.ts`** — `initPostHog()`, `syncAnalyticsSettings()` — renderer-side PostHog client (posthog-js) initialization
- **`electron/src/lib/error-utils.ts`** — `extractErrorMessage()`, `reportError()` — shared error extraction and PostHog exception capture
- **`electron/src/lib/git-exec.ts`** — git command execution helpers used by `ipc/git.ts`
- **`electron/src/lib/jira-client.ts`** — Jira REST API client (search, fetch issue, update)
- **`electron/src/lib/migration.ts`** — data migration utilities for localStorage and file store upgrades
- **`electron/src/lib/claude-binary.ts`** / **`codex-binary.ts`** — CLI binary detection (managed download path + custom user path)
- **`electron/src/lib/mcp-oauth-flow.ts`** / **`mcp-oauth-provider.ts`** — MCP OAuth provider server (loopback redirect) + flow orchestration

### Error Tracking (PostHog)

Two PostHog clients run in parallel, one per process:

1. **Main process** (`posthog-node` in `electron/src/lib/posthog.ts`):
   - `enableExceptionAutocapture: true` — auto-captures `process.on('uncaughtException')` and `process.on('unhandledRejection')`
   - `captureException(error, additionalProperties?)` — manual exception capture with stack trace
   - `captureEvent(event, properties?)` — custom analytics events
   - Respects `analyticsEnabled` setting, uses anonymous `analyticsUserId`

2. **Renderer process** (`posthog-js` + `@posthog/react` in `src/lib/posthog.ts`):
   - Exception autocapture via `defaults: "2026-01-30"` — auto-hooks `window.onerror` and `window.onunhandledrejection`
   - `PostHogProvider` wraps the app in `main.tsx`
   - `ErrorBoundary.componentDidCatch` → `posthog.captureException()` for React rendering errors
   - Starts opted-out (`opt_out_capturing_by_default: true`), syncs to main process settings via `syncAnalyticsSettings()`
   - Uses same anonymous user ID as main process for cross-process correlation

**Error reporting helpers:**

- **Main process**: `reportError(label, err, context?)` from `electron/src/lib/error-utils.ts` — combines `log()` + `captureException()` in one call, returns the error message string. Use in all IPC handler catch blocks.
- **Renderer**: `reportError(label, err, context?)` from `src/lib/analytics.ts` — combines `console.error()` + `captureException()`, returns the message string. Use in hook/component catch blocks.
- **Renderer**: `captureException(error, properties?)` from `src/lib/analytics.ts` — PostHog-only capture (when console logging already exists).

**When to use `reportError` vs leave a catch alone:**
- **DO use `reportError`**: session start/stop failures, IPC handler errors, SDK/process spawn errors, OAuth failures, updater errors, file operation errors, user-visible errors
- **DO NOT use `reportError`**: process kill cleanup (`/* already dead */`), JSON parse fallbacks, audio autoplay blocked, cache parse defaults, cancellation guards, analytics-internal catches (infinite recursion)

### Electron Session Handler Patterns

The three session IPC handlers share extracted utilities:
- **`createAcpConnection()`** — factory for ACP process spawn + ClientSideConnection setup (eliminates duplication between `acp:start` and `acp:revive-session`)
- **`setupCodexHandlers()`** — wires RPC handlers for Codex sessions (shared between `codex:start` and `codex:resume`)
- **`startEventLoop()`** — iterates SDK QueryHandle async generator with event forwarding (shared between `claude:start` and `restartSession`)
- **`oneShotSdkQuery()`** — fire-and-forget SDK query with timeout (shared between title gen and commit message gen)

## Coding Conventions

- **Tailwind v4** — no CSS resets, Preflight handles normalization
- **ShadCN UI** — use `@/components/ui/*` for base components
- **Path aliases** — `@/` for renderer src/, `@shared/` for shared types
- **Logical margins** — use `ms-*`/`me-*` instead of `ml-*`/`mr-*`
- **Text overflow** — use `wrap-break-word` on containers with user content
- **No `any`** — use proper types, never `as any`
- **No unsafe `as` casts** — use discriminated unions and type guards instead of `as Record<string, unknown>`
- **No false optionals** — never mark props/parameters as optional (`?`) when they are always provided by every caller. Optional means "sometimes absent" — if every call site passes the value, make it required. Lazy `?` hides broken contracts and leads to unnecessary null checks.
- **pnpm** — always use pnpm for package management
- **Memo optimization** — components use `React.memo` with custom comparators for performance
- **Component decomposition** — large components are split into focused sub-components in subdirectories (git/, browser/, input-bar/, jira/, mcp/, mcp-renderers/, tool-renderers/, sidebar/, split/, welcome/, workspace/)
- **Hook decomposition** — large hooks are split into focused sub-hooks (session/, app-layout/, useEngineBase)
- **Shared components** — reusable UI patterns extracted to shared components (`TabBar`, `PanelHeader`, `SettingRow`)
- **Error tracking** — all caught errors in IPC handlers and hooks must use `reportError(label, err)` (not bare `log()`). Benign/expected catches (cleanup, parse fallbacks, cancellation guards) are exempt. See "Error Tracking (PostHog)" section for details.

## Performance Guidelines

Hard-won lessons from the chat rendering rebuild. Apply these whenever building list-heavy or streaming-heavy UI.

### Virtualization over content-visibility

**Never use `content-visibility: auto` for long lists.** It keeps all DOM nodes alive (300+ React trees in memory) and merely defers painting. Use `@tanstack/react-virtual` (or equivalent) for true windowing — only ~20 DOM nodes exist regardless of list length. This is the single biggest perf win for large chats.

### Streaming update isolation

During streaming, only the last message changes. The entire render path must be designed so that only that one component re-renders per frame:

- **Referential identity**: React state updates that spread an array (`[...msgs.slice(0, -1), updatedLast]`) preserve object references for unchanged items. `React.memo` with `prev.msg === next.msg` correctly skips them.
- **Structural identity caching**: expensive derived data (tool groups, turn summaries) should only recompute when the message *structure* changes (new message added, tool result arrives), not when streaming content updates. Cache with a `structureKey` (length + lastId + toolResultCount) and skip recomputation when it hasn't changed.
- **Never pass the full messages array as a prop to row components** — it changes on every frame. Pass individual message objects or use refs.

### Refs for transient values, not state

Scroll position, bottom-lock state, animation frame IDs, user scroll intent timestamps — these change on every frame and must **never** be `useState`. Use `useRef` and read them in event handlers. A `useState` for scroll position causes a full re-render on every scroll event.

### Module-level components and functions

Components defined inside other components (`const Row = () => ...` inside a list component) are re-created on every render, destroying all internal state and remounting the DOM. Always extract to module level. Same for helper functions used in `useMemo` — define them outside the component to avoid stale closure issues and enable referential stability.

### Height estimation for virtualizers

`@tanstack/react-virtual` needs `estimateSize` for items before measurement. Provide role-based estimates (system: 32px, tool_call: 44px, user: 48-200px, assistant: 40-600px scaled by content length). The virtualizer corrects via `measureElement` after first render. Poor estimates cause scroll jumps but are self-healing.

### Explicit height vs CSS padding with border-box

When setting explicit `height` on a container, **do not use CSS padding** (`pt-*`, `pb-*`). With Tailwind's `box-sizing: border-box`, padding is subtracted from the content area, shrinking it below what the virtualizer expects. Instead, add padding values directly to the height calculation:
```tsx
style={{ height: `${virtualizer.getTotalSize() + headerSpace + bottomSpace}px` }}
```

### Performance best practices reference

See `.agents/skills/vercel-react-best-practices/` for 62 rules across 8 categories (waterfalls, bundle size, re-renders, rendering, JS perf). Key rules applied in this codebase:
- `rerender-use-ref-transient-values` — refs for scroll/animation state
- `rerender-no-inline-components` — module-level components
- `rerender-memo` — custom comparators on row components
- `js-index-maps` / `js-set-map-lookups` — Map/Set for O(1) lookups
- `js-combine-iterations` — single-pass row building
- `advanced-event-handler-refs` — callback refs to avoid effect re-subscription