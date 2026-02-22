# OpenACP UI

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
- **Package manager**: pnpm
- **Path alias**: `@/` → `./src/`

## Project Structure

```
electron/
├── tsconfig.json            # Electron-specific TS config (CJS output)
├── dist/                    # tsup build output (gitignored)
│   ├── main.js
│   └── preload.js
└── src/
    ├── main.ts              # App entry: createWindow, app lifecycle, devtools, registers all IPC
    ├── preload.ts            # contextBridge exposing window.claude API + glass detection
    ├── lib/
    │   ├── logger.ts         # log(), logStream setup
    │   ├── async-channel.ts  # AsyncChannel class for multi-turn SDK input
    │   ├── data-dir.ts       # getDataDir, getProjectSessionsDir, getSessionFilePath
    │   ├── app-settings.ts   # AppSettings JSON store (main-process settings persisted to data dir)
    │   ├── glass.ts          # Liquid glass detection + glassEnabled export
    │   ├── sdk.ts            # Cached getSDK() for @anthropic-ai/claude-agent-sdk
    │   └── git-exec.ts       # gitExec() helper + ALWAYS_SKIP set
    └── ipc/
        ├── claude-sessions.ts # claude:start/send/stop/interrupt/permission_response/set-permission-mode
        ├── title-gen.ts       # claude:generate-title, git:generate-commit-message
        ├── projects.ts        # projects:list/create/delete/rename/reorder/update-space
        ├── sessions.ts        # sessions:save/load/list/delete/search
        ├── settings.ts        # settings:get/set (main-process AppSettings with change listeners)
        ├── spaces.ts          # spaces:list/save
        ├── files.ts           # files:list/read-multiple, file:read/open-in-editor
        ├── terminal.ts        # terminal:create/write/resize/destroy
        ├── git.ts             # git:status/stage/unstage/commit/branches/checkout/push/pull/fetch/diff-file/log/discover-repos
        └── cc-import.ts       # cc-sessions:list/import (Claude Code JSONL transcript conversion)

src/
├── main.tsx         # React entry point
├── App.tsx          # Root: glass detection, TooltipProvider + AppLayout
├── index.css        # Tailwind v4 + ShadCN theme (light/dark, glass morphism, shimmer animation)
│
├── types/
│   ├── protocol.ts  # Claude CLI stream-json wire types (ClaudeEvent, StreamEvent, etc.)
│   ├── ui.ts        # UIMessage, SessionInfo, Project, ChatSession, PersistedSession,
│   │                #   PermissionRequest, TodoItem, BackgroundAgent, ImageAttachment, ContextUsage
│   ├── window.d.ts  # Window.claude type augmentation (sessions, projects, files, ccSessions, permissions)
│   └── index.ts     # Re-exports (import from "@/types")
│
├── lib/
│   ├── utils.ts                  # ShadCN cn() utility
│   ├── protocol.ts               # Pure helpers: normalizeToolResult, extractTextContent, buildSdkContent, getParentId
│   ├── streaming-buffer.ts       # StreamingBuffer class (no React dependency)
│   ├── background-agent-parser.ts # Parses background agent JSONL output files
│   └── background-session-store.ts # BackgroundSessionStore: event accumulator for non-active sessions
│
├── hooks/
│   ├── useClaude.ts              # Event handling, streaming, subagent routing, permissions (per-session)
│   ├── useSessionManager.ts      # Multi-session orchestrator: create, switch, persist, background store
│   ├── useSidebar.ts             # Sidebar open/close state (localStorage)
│   ├── useBackgroundAgents.ts    # Polls async Task agent output files for activity updates
│   └── useProjectManager.ts      # Project CRUD (create via folder picker, rename, delete)
│
└── components/
    ├── ui/                       # ShadCN base components (auto-generated)
    ├── AppLayout.tsx             # Root layout: sidebar + chat + right panels (todos/agents, tools, tool picker)
    ├── AppSidebar.tsx            # Collapsible sidebar with projects, sessions grouped by date, CC import
    ├── ChatHeader.tsx            # Model badge, permission mode, cost, session ID, sidebar toggle
    ├── ChatView.tsx              # Message list with ScrollArea auto-scroll, continuation detection
    ├── MessageBubble.tsx         # Markdown rendering, syntax highlighting, images, @file mentions
    ├── ThinkingBlock.tsx         # Collapsible thinking content with streaming indicator
    ├── ToolCall.tsx              # Tool cards with icons, DiffViewer for edits, TaskTool for subagents, MCP routing
    ├── McpToolContent.tsx        # Extensible MCP tool renderer registry (Jira, Confluence, Rovo, etc.)
    ├── InputBar.tsx              # Textarea, @file mentions, image paste/drag, model/permission dropdowns, context gauge
    ├── WelcomeScreen.tsx         # Empty state: "Open a project" or "Select a thread"
    ├── CopyButton.tsx            # Clipboard copy with animated check feedback
    ├── DiffViewer.tsx            # Unified diff with word-level highlights, context collapsing, line numbers
    ├── PermissionPrompt.tsx      # Tool permission UI, ExitPlanMode prompt, AskUserQuestion prompt
    ├── SummaryBlock.tsx          # Context compaction summary with token counts
    ├── TodoPanel.tsx             # Right-side task list with progress bar and status icons
    ├── BackgroundAgentsPanel.tsx # Background agent cards with activity logs and status
    ├── ToolPicker.tsx            # Vertical tool bar: toggles tool panels on/off (terminal, browser, files)
    ├── ToolsPanel.tsx            # Terminal panel: multi-tab xterm.js instances backed by node-pty
    ├── BrowserPanel.tsx          # Browser panel: multi-tab Electron webview with URL bar + navigation
    ├── SettingsView.tsx          # Settings panel with nav sidebar, loads AppSettings from main process
    ├── settings/
    │   ├── GeneralSettings.tsx   # General section: pre-release updates toggle, etc.
    │   ├── AgentSettings.tsx     # ACP agent CRUD (create, edit, delete, paste-JSON import)
    │   └── PlaceholderSection.tsx # Empty placeholder for unimplemented sections
    ├── FilesPanel.tsx            # Open Files panel: derives accessed files from session messages
    └── OpenInEditorButton.tsx    # Subtle hover button to open file in external editor (cursor/code/zed)
```

## How to Run

```bash
pnpm install
pnpm dev       # Starts Vite dev server + tsup watch + Electron
pnpm build     # tsup (electron/) + Vite (renderer) production build
pnpm start     # Run Electron with pre-built dist/
```

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

- `sessions:save(data)` — writes to `{userData}/openacpui-data/sessions/{projectId}/{id}.json`
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

### Settings Architecture

Two tiers of settings storage, each suited to different access patterns:

1. **`useSettings` hook** (renderer, localStorage) — UI preferences that only the renderer needs: model, permissionMode, panel widths, active tools, thinking toggle. Per-project settings keyed by `openacpui-{projectId}-*`, global settings keyed by `openacpui-*`.

2. **`AppSettings` store** (main process, JSON file) — settings that the main process needs at startup before any BrowserWindow exists (e.g. `autoUpdater.allowPrerelease`). File location: `{userData}/openacpui-data/settings.json`. Accessed via `getAppSettings()`/`setAppSettings()` in `electron/src/lib/app-settings.ts`. The `settings` IPC module exposes `settings:get`/`settings:set` to the renderer and fires `onSettingsChanged` listeners for in-process consumers (e.g. the updater).

**When to use which:** Use `useSettings` for renderer-only preferences. Use `AppSettings` when the main process must read the value synchronously at startup or react to changes (e.g. updater config, window behavior).

### State Architecture

- `useSessionManager` — top-level orchestrator: session list, create/switch/delete, auto-save, background store coordination
- `useClaude({ sessionId })` — per-session event handling, streaming buffer, subagent routing, permission state
- `useProjectManager` — project CRUD via IPC
- `useBackgroundAgents` — polls async Task agent output files every 3s, marks complete after 2 stable polls
- `useSidebar` — sidebar open/close with localStorage persistence

**BackgroundSessionStore** — accumulates events for non-active sessions to prevent state loss when switching. On switch-away, session state is captured into the store; on switch-back, state is consumed from the store (or loaded from disk if no live process).

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
1. Create a component in `McpToolContent.tsx` that accepts `{ data: unknown }`
2. Register in `MCP_RENDERERS` (exact name) and/or `MCP_RENDERER_PATTERNS` (regex with `[/_]+`)
3. Also add to `getMcpCompactSummary()` for collapsed tool card summaries

**Tool naming conventions**:
- SDK engine: `mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql`
- ACP engine: `Tool: Atlassian/searchJiraIssuesUsingJql`
- All regex patterns use `Atlassian[/_]+` to match both
- `ToolCall.tsx` label logic (`getMcpToolLabel`, `formatCompactSummary`, `MCP_TOOL_LABELS`) handles both prefixes

**Text-based tools**: Some MCP tools (e.g., Context7) return plain text/markdown instead of JSON. `extractMcpText()` extracts the raw text, passed to renderers as `rawText` prop alongside `data` (which will be `null` for non-JSON responses). Text-based renderers should parse the `rawText` string themselves.

**Existing renderers**: `JiraIssueList` (search), `JiraIssueDetail` (getJiraIssue/fetch), `ConfluencePageDetail`, `RovoSearchResults`, `AtlassianResourcesList` (getAccessibleAtlassianResources), `Context7LibraryList` (resolve-library-id), `Context7DocsResult` (query-docs)

## Reference Documentation

When working on engine-related code, always consult these local docs:

- **Claude Agent SDK (Anthropic engine)**: `docs/ai-sdk/` — covers `query()`, MCP config, permissions, streaming, session management, subagents, etc.
- **ACP TypeScript SDK**: `docs/typescript-sdk-main/` — the `@anthropic-ai/agent-client-protocol` package, ACP client/server types, transport
- **Agent Client Protocol spec**: `docs/agent-client-protocol-main/` — ACP protocol spec, schema definitions, event types

Always search the web when needed for up-to-date API references, Electron APIs, or third-party package docs.

## Coding Conventions

- **Tailwind v4** — no CSS resets, Preflight handles normalization
- **ShadCN UI** — use `@/components/ui/*` for base components
- **Path aliases** — always use `@/` imports in src/ files
- **Logical margins** — use `ms-*`/`me-*` instead of `ml-*`/`mr-*`
- **Text overflow** — use `wrap-break-word` on containers with user content
- **No `any`** — use proper types, never `as any`
- **pnpm** — always use pnpm for package management
- **Memo optimization** — components use `React.memo` with custom comparators for performance