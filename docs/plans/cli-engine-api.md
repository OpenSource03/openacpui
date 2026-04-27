# CLI Engine — IPC + State Contract

> **Status: implemented (2026-04-28)**. The contract below describes the shipped surface; sections marked *deferred* in the original draft were resolved during Phase 1 and now have explicit answers (fork id discovery via fs.watch, archive cwd-based path derivation, etc.). Diff vs. ship: archive takes `cwd` (not `cwdHash`), `cli:fork` IPC was added as a separate verb (originally folded into `cli:resume`), composer punt from Phase 3 became a permanent drop.

Companion to `docs/plans/cli-mode.md`. Locked the IPC surface and renderer
state shape **before** Phase 1 implementation so the design was reviewable
independent of code, and Phase 1 had a clear target rather than discovering
the API as it went.

Type stubs live in `shared/types/cli-engine.ts`. This doc explains the why.

---

## Boundary diagram

```
┌──────────────────────── renderer process ────────────────────────┐
│                                                                  │
│  CliChatPanel (xterm full-screen)                                │
│       │                                                          │
│       ▼                                                          │
│  useCliSession  ──────► state mirror (CliSessionState)           │
│       │                                                          │
│       ├── window.claude.cli.start(opts)        ──── IPC ────┐    │
│       ├── window.claude.cli.resume(opts)       ──── IPC ────┤    │
│       ├── window.claude.cli.stop(sessionId)    ──── IPC ────┤    │
│       ├── window.claude.cli.list({ cwd? })     ──── IPC ────┤    │
│       ├── window.claude.cli.fork(id)           ──── IPC ────┤    │
│       ├── window.claude.cli.archive(id)        ──── IPC ────┤    │
│       │                                                     │    │
│       ▲                                                     │    │
│       └── onCliEvent(callback)              ◄──── event ────┤    │
│                                                             │    │
└─────────────────────────────────────────────────────────────┼────┘
                                                              │
┌──────────────────────── main process ────────────────────────────┐
│                                                              ▼   │
│  electron/src/ipc/cli-sessions.ts                                │
│       │                                                          │
│       ├── spawn `claude --session-id <uuid> --cwd <cwd>`         │
│       │     via node-pty (reuse existing terminal helpers)       │
│       ├── wire pty stdout → existing `terminal:data` channel     │
│       │     (renderer keeps using the same xterm wiring)         │
│       ├── on exit → emit `cli:event { type: "exited" }`          │
│       └── list/fork/archive → fs operations on                   │
│             ~/.claude/projects/*/sessions-index.json             │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

Key reuse: **the pty data plane is already implemented**. We don't add
another byte stream — we layer "session semantics" on top of the existing
terminal IPC. `cli:start` returns a `terminalId` that's interchangeable with
ones produced by `terminal:create`, so xterm wiring needs no changes.

---

## IPC verbs

### `cli:start(opts: CliStartOptions): Promise<CliStartResult>`

Spawns `claude` in a pty with the requested cwd and a fresh `--session-id`.

`CliStartResult` is a discriminated union — on success
`{ ok: true, terminalId, sessionId, pid }`, on failure
`{ ok: false, sessionId, error }`. Spawn syscall failures (missing
binary, EACCES, invalid cwd) resolve with `ok: false` rather than
rejecting, so renderer error UX is one path. Post-spawn failures (CLI
immediately exits with an auth error) flow through the
`spawn_failed` / `resume_failed` events instead.

Backing command:

```
claude
  --session-id <uuid>
  --cwd <cwd>
  [--name <name>]
  [--permission-mode <mode>]
  [--model <model>]
  [--add-dir <dir>]...
  [--mcp-config <file>]...
```

Returns when the spawn syscall completes — does **not** wait for CLI's first
prompt. UI shows a "starting…" overlay until the first stdout chunk fires
the existing `terminal:data` event, at which point `useCliSession` flips
`ready=true` and reveals the xterm.

### `cli:resume(opts: CliResumeOptions): Promise<CliStartResult>`

Same as start but with `--resume <uuid>`. The settings-bearing fields
(`model`, `permissionMode`, `addDirs`, `mcpConfigs`, `name`) mirror
`CliStartOptions` because CLI accepts them with `--resume` and we'd lose
user intent across reopens otherwise.

If `fork=true`, also passes `--fork-session`. **The returned `sessionId`
in this case is the input id, not the new forked id** — CLI mints the new
id and writes it to its session state asynchronously. Main process
discovers it (via fs watch on `~/.claude/projects/{cwdHash}/` or by
parsing CLI's status line) and emits a `session_identified` event with
both the provisional and real id. Renderer rekeys its state map on that
event before routing any further IPC at the new id.

### `cli:stop(sessionId: string): Promise<{ ok: boolean }>`

Sends SIGTERM to the underlying `claude` process and tears down the pty.
Idempotent — calling on an already-exited session is a no-op.

### `cli:list({ cwd? }): Promise<AllSessionsEntry[]>`

Convenience wrapper around the `cc-sessions:list-all` handler from PR #9
(Track B), filtered to a single cwd when `cwd` is provided. Reused by the
"All CLI sessions in this project" affordance in the new-session dropdown.

> If Track B's IPC ends up being the only consumer, this verb collapses into
> a renderer-side filter. Decide during Phase 1.

### `cli:fork(sessionId): Promise<CliStartResult>`

Shorthand for `cli:resume({ sessionId, fork: true })`. Convenience verb so
the UI doesn't have to know the flag name.

### `cli:archive(target: CliArchiveTarget): Promise<{ ok: boolean; error?: string }>`

`CliArchiveTarget = { sessionId: string; cwdHash: string; fullPath?: string }`

Takes the **already-resolved** entry from the global session list so we
don't re-derive the hash from `cwd` (a lossy transform — paths with `-`
in them collide). The `fullPath` field is optional for backwards-compat
but should be passed when known.

Behavior:

1. Move the JSONL from
   `~/.claude/projects/{cwdHash}/{sessionId}.jsonl` to
   `~/.claude/projects/{cwdHash}/.archived/{sessionId}.jsonl`.
2. **Decision required by Phase 1**: how does CLI handle a removed entry
   in `sessions-index.json`?
   - **If CLI rebuilds the index from `.jsonl` files on each read**:
     removing the entry is wasted work — moving the JSONL is enough.
   - **If CLI persists removed entries**: we mutate the index by
     filtering out the row. Schema-stable enough that a write should be
     safe.
   - **If CLI re-adds entries on next scan** (worst case): Harnss needs
     its own tombstone file (e.g. `~/.claude/projects/{cwdHash}/.harnss-archived.json`)
     because we can't reliably suppress what CLI writes back.

   **Phase 1 must verify with `claude` 2.1.x before shipping archive.**
   Until verified, ship archive as a **rename-only** operation behind a
   feature flag and log when CLI's index mismatches Harnss's view.

### `cli:listLive(): Promise<CliLiveSession[]>`

Authoritative list of CLI sessions currently alive in this Harnss
instance — `sessionId → terminalId, pid, cwd, startedAt`. Used on session
switch / window reload to recover state without spawning a duplicate. The
existing `terminal:list` covers the byte-buffer reattach path but doesn't
carry CLI-specific metadata like `sessionId` or `cwd`.

### Events: `cli:event` (broadcast)

Carries `CliSessionEvent` payloads. `_sessionId` is appended by `safeSend`
so the renderer can filter to the active session, matching the existing
Claude / ACP / Codex event channels.

The `terminal:data` channel **already** carries the actual stdout/stderr
bytes — `cli:event` only fires on lifecycle transitions:

- `spawned` / `resumed` — process is up; renderer flips state to "running"
- `session_identified` — fork minted a new id; renderer rekeys its map
- `spawn_failed` / `resume_failed` — CLI couldn't start (bad flag, auth
  error, missing binary); renderer flips status to "error" with the message
- `exited` — process ended; renderer keeps the xterm buffer scrollable

---

## Renderer state

```ts
const [state, setState] = useState<CliSessionState | null>(null);
```

Reset shape when the active session changes (sessions are 1:1 with
`CliSessionState`, no message accumulation here).

### Lifecycle

```
mount + active session has engine="cli"
   │
   ▼
cli:listLive() → if found, attach to existing terminalId; else cli:start
   │
   ▼
state = { status: "starting", ready: false, errorMessage: null }
   │
   ▼
spawned / resumed event arrives
   │
   ▼
state = { status: "running", terminalId, pid }
   │
   ▼
first terminal:data chunk
   │
   ▼
ready = true   ← reveals xterm; before this we show a spinner overlay
   │
   ▼ (resume with fork=true only)
session_identified event
   │
   ▼
rekey state map: provisionalSessionId → real sessionId
   │
   ▼
exited event                    spawn_failed / resume_failed event
   │                                       │
   ▼                                       ▼
status = "exited"                status = "error", errorMessage set
(keep terminalId for scrollback) (UI shows error + Retry / Close)
```

### Why no `messages` array

CLI mode deliberately gives up structured tool-call rendering. The chat is
the xterm buffer. If users want rich tool cards they pick the SDK engine.
Keeping `messages` empty here is a feature, not an oversight — it's what
makes the engine cheap to add.

---

## Permission UX

The CLI renders permission prompts inside the pty using its own ANSI
selection menus. We do **not** intercept these in the first cut. Risks if
we did:

- ANSI parsing tightly couples Harnss to a CLI version
- CLI permission UX evolves; we'd be permanently behind
- The CLI prompt is keyboard-driven and works fine in xterm

Tradeoff accepted: permission UX in CLI mode looks different from SDK mode.
That's fine — the engine choice is explicit per-session.

---

## Composer

Covered in `docs/plans/cli-mode.md` Phase 3. Briefly: an overlay textarea
above the xterm captures input → `pty.write(text + "\r")` on submit →
draft is keyed by `sessionId` in localStorage, identical persistence story
to the SDK composer. Implementation lands in Phase 3.

---

## What this doc is not

- **Not a final code design.** Field names may shift during Phase 1 review
  if reality shows mismatches.
- **Not exhaustive of every IPC.** Things like `cli:set-permission-mode`,
  `cli:write-stdin` (manual `pty.write` for keyboard macros) get added
  during implementation if needed.
- **Not a commitment to ship.** Phase 0 still has to demonstrate that PTY
  emulation handles CLI's full TUI before any of this matters.

---

## Sequencing reminder

```
Phase 0  PTY probe (manual, user)
   │
   ▼  pass?
Phase 1  Implement this doc — cli-sessions.ts + useCliSession + CliChatPanel
   │
   ▼  Track A merges
Phase 2  Already shipped via PR #9
   │
   ▼
Phase 3  Composer overlay (this doc + cli-mode.md Phase 3)
   │
   ▼
Phase 4  Decide route A vs B (cli replaces SDK or both stay)
```
