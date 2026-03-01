<p align="center">
  <img width="3168" height="1344" alt="unwatermarked_Gemini_Generated_Image_yb5gjqyb5gjqyb5g (1) (1)" src="https://github.com/user-attachments/assets/f3985b4c-7f8e-4d04-86a6-66529db2af8e" />
</p>

<p align="center">
  <strong>Harness your AI coding agents.</strong>
</p>

<p align="center">
  <a href="https://github.com/OpenSource03/harnss/releases"><img alt="Latest Release" src="https://img.shields.io/github/v/release/OpenSource03/harnss?style=flat-square&color=blue" /></a>
  <a href="https://github.com/OpenSource03/harnss/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/OpenSource03/harnss?style=flat-square" /></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-brightgreen?style=flat-square" />
  <img alt="Electron" src="https://img.shields.io/badge/electron-40-47848F?style=flat-square&logo=electron&logoColor=white" />
  <img alt="License" src="https://img.shields.io/github/license/OpenSource03/harnss?style=flat-square" />
  <a href="https://github.com/OpenSource03/harnss/actions"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/OpenSource03/harnss/build.yml?style=flat-square&label=build" /></a>
</p>

---

Harnss is a native desktop app that gives you one interface to run, manage, and switch between AI coding agents — Claude Code, Codex, and any ACP-compatible agent — without losing context, sessions, or tool state.

**Why Harnss?**

- **One app, every agent.** Run Claude Code, Codex, and custom ACP agents side by side. No more juggling terminals or losing context when switching tools.
- **See what your AI is actually doing.** Tool calls render as interactive cards with word-level diffs, syntax highlighting, and inline bash output — not raw JSON.
- **Your workspace, your way.** Built-in terminal, browser, git, MCP servers, and file panels — all scoped per project, all staying open while you work.

---

## Screenshots

<!-- TODO: Replace these placeholders with real app screenshots -->

<p align="center">
  <img src=".github/screenshots/multi-session.png" alt="Multiple concurrent agent sessions" width="800" />
  <br />
  <em>Run multiple agent sessions side by side — switch instantly without losing progress.</em>
</p>

<p align="center">
  <img src=".github/screenshots/tool-visualization.png" alt="Rich tool call visualization" width="800" />
  <br />
  <em>Every tool call renders as an interactive card. File edits show word-level diffs with syntax highlighting.</em>
</p>

<p align="center">
  <img src=".github/screenshots/workspace.png" alt="Full workspace with terminal, browser, and git" width="800" />
  <br />
  <em>Terminal, browser, git, and MCP integrations — all in one window.</em>
</p>

---

## Features

### Multi-engine sessions

Run Claude Code (via the Anthropic SDK), Codex, and ACP-compatible agents in parallel. Each session has its own state, history, and context. Switch between them instantly.

### Rich tool visualization

Every tool call renders as an interactive card. File edits show word-level diffs with syntax highlighting. Bash output appears inline. Subagent tasks nest with step-by-step progress tracking. File changes are summarized per turn with a dedicated Changes panel.

### MCP server management

Connect any MCP server per project via stdio, SSE, or HTTP transport. OAuth flows are handled automatically. Server status and available tool counts are visible at a glance. Jira, Confluence, and other integrations render with dedicated UIs rather than raw JSON.

### Git integration

Stage, unstage, commit, and push without leaving the app. Browse branches, view commit history, and manage git worktrees. AI-generated commit messages are available from the staged diff.

### Built-in terminal & browser

Multi-tab PTY terminal backed by native shell processes. An embedded browser for opening URLs inline. Both panels stay mounted while you work.

### Project workspaces & spaces

Projects map to folders on disk. Spaces let you organize projects into named groups with custom icons and colors. Sessions, history, and panel settings are all scoped per project.

### Agent Store

Browse and install agents from the ACP community registry directly in the app. Add custom agents by specifying a command, arguments, environment variables, and an icon. All configuration is managed through Settings — no config files.

### Thinking mode

Watch Claude reason through problems in collapsible thinking blocks before it acts. Toggle extended reasoning per session.

### Voice input & notifications

Voice input via native macOS dictation or an on-device Whisper model (no API key required). Configurable OS notifications for plan approval requests, permission prompts, agent questions, and session completion.

### Session search & history

Full-text search across session titles and message content. Import and resume conversations previously started in the Claude Code CLI.

---

## Quick Start

1. **Download** the latest release for your platform from the [Releases page](https://github.com/OpenSource03/harnss/releases/latest)
2. **Open a project** — point Harnss at any folder on disk
3. **Choose an engine** — Claude Code, Codex, or any installed ACP agent — and start working

---

## Engines & Agents

Harnss supports three execution engines out of the box:

| Engine | Protocol | Requirements |
|--------|----------|--------------|
| **Claude Code** | Anthropic Agent SDK | Claude account (subscription or API key) |
| **Codex** | JSON-RPC app-server | Codex CLI in PATH + OpenAI API key or ChatGPT account |
| **ACP agents** | Agent Client Protocol | Agent-specific (see registry) |

Claude Code and Codex are built-in. ACP agents can be installed from the [ACP Agent Registry](https://agentclientprotocol.com/get-started/registry) inside the app, or configured manually.

**Examples of installable ACP-compatible agents:**

| Agent | Command | Notes |
|-------|---------|-------|
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `gemini --experimental-acp` | Experimental ACP flag |
| [Goose](https://github.com/block/goose) | `goose acp` | |
| [Docker cagent](https://github.com/docker/cagent) | `cagent acp agent.yml` | Container-based agents |

### Adding an agent

Open **Settings → ACP Agents**. The **Agent Store** tab lets you browse and install agents from the community registry. The **My Agents** tab lets you create custom agents — set the binary command, arguments, environment variables, and icon, or paste a JSON definition to auto-fill the form.

---

## MCP Servers

MCP servers are configured per project through the **MCP Servers panel** in the right-side toolbar. Supported transports: stdio, SSE, and HTTP. OAuth authentication is handled in-app with token persistence across sessions.

---

## Install

> [!NOTE]
> Pre-built binaries are currently **unsigned**. On macOS, right-click the app and choose **Open** to bypass the Gatekeeper warning on first launch. On Windows, click **More info → Run anyway** if Windows Defender flags the installer.

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | [`.dmg` (arm64)](https://github.com/OpenSource03/harnss/releases/latest) |
| macOS (Intel) | [`.dmg` (x64)](https://github.com/OpenSource03/harnss/releases/latest) |
| Windows (x64) | [`.exe` installer](https://github.com/OpenSource03/harnss/releases/latest) |
| Windows (ARM64) | [`.exe` installer](https://github.com/OpenSource03/harnss/releases/latest) |
| Linux | [`.AppImage`](https://github.com/OpenSource03/harnss/releases/latest) / [`.deb`](https://github.com/OpenSource03/harnss/releases/latest) |

---

## Development

```bash
git clone https://github.com/OpenSource03/harnss.git
cd harnss
pnpm install
pnpm dev
```

### Build installers

```bash
pnpm dist:mac      # macOS DMG (arm64 + x64)
pnpm dist:win      # Windows NSIS installer (x64 + ARM64)
pnpm dist:linux    # Linux AppImage + deb
```

---

## Contributing

1. Fork the repo and create a feature branch
2. Follow the conventions in `CLAUDE.md`
3. Test with `pnpm dev`
4. Open a pull request

---

## License

MIT

---

<p align="center">
  Built on the <a href="https://agentclientprotocol.com">Agent Client Protocol</a>
</p>
