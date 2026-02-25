<p align="center">
  <img src=".github/banner.png" alt="OpenACP UI" />
</p>

<p align="center">
  <a href="https://github.com/OpenSource03/openacpui/releases"><img alt="Latest Release" src="https://img.shields.io/github/v/release/OpenSource03/openacpui?style=flat-square&color=blue" /></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-brightgreen?style=flat-square" />
  <img alt="Electron" src="https://img.shields.io/badge/electron-40-47848F?style=flat-square&logo=electron&logoColor=white" />
  <img alt="License" src="https://img.shields.io/github/license/OpenSource03/openacpui?style=flat-square" />
  <a href="https://github.com/OpenSource03/openacpui/actions"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/OpenSource03/openacpui/build.yml?style=flat-square&label=build" /></a>
</p>

---

> [!WARNING]
> This project is in active development. Expect bugs, breaking changes, and missing features.

OpenACP UI is a native desktop app for running and managing AI coding agents. It supports multiple concurrent sessions across three first-class engines — Claude Code, Codex, and any ACP-compatible agent — with a unified interface for tools, context, and project workflows.

## Features

**Multi-engine sessions** — Run Claude Code (via the Anthropic SDK), Codex, and ACP-compatible agents side by side. Each session runs independently with its own state, history, and context. Switch between them instantly without losing progress.

**Rich tool visualization** — Every tool call renders as an interactive card. File edits show word-level diffs with syntax highlighting. Bash output appears inline. Subagent tasks nest with step-by-step progress tracking. File changes are summarized per turn with a dedicated Changes panel for both per-turn and cumulative views.

**MCP server management** — Connect any MCP server per project via stdio, SSE, or HTTP transport. OAuth flows are handled automatically. Server status and available tool counts are visible at a glance. Reconnect or re-authenticate without restarting your session. Jira, Confluence, and other integrations render with dedicated UIs rather than raw JSON.

**Git integration** — Stage, unstage, commit, and push without leaving the app. Browse branches, view commit history, and manage git worktrees. AI-generated commit messages are available from the staged diff.

**Built-in terminal and browser** — Multi-tab PTY terminal backed by native shell processes. An embedded browser for opening URLs inline. Both panels stay mounted while you work.

**Project workspaces and spaces** — Projects map to folders on disk. Spaces let you organize projects into named groups with custom icons and colors. Sessions, history, and panel settings are all scoped per project.

**Agent Store** — Browse and install agents from the ACP community registry directly in the app. Add custom agents by specifying a command, arguments, environment variables, and an icon. All agent configuration is managed through Settings — no config file editing required.

**Thinking mode** — Watch Claude reason through problems in collapsible thinking blocks before it acts. Toggle extended reasoning per session.

**Session search and history** — Full-text search across session titles and message content. Import and resume conversations previously started in the Claude Code CLI.

**Notifications and voice input** — Configurable OS notifications for key events: plan approval requests, permission prompts, questions from the agent, and session completion. Voice input via native macOS dictation or an on-device Whisper model (no API key required).

**Auto-updates** — The app checks for new releases on launch and shows a banner when an update is ready to install. Pre-release builds can be opted into in Settings.

## Engines & Agents

OpenACP UI supports three execution engines:

| Engine | Protocol | Requirements |
|--------|----------|--------------|
| **Claude Code** | Anthropic Agent SDK | Claude account (subscription or API key) |
| **Codex** | JSON-RPC app-server | Codex CLI in PATH + OpenAI API key or ChatGPT account |
| **ACP agents** | Agent Client Protocol | Agent-specific (see registry) |

Claude Code and Codex are built-in — no command configuration needed. ACP agents can be installed from the [ACP Agent Registry](https://agentclientprotocol.com/get-started/registry) inside the app, or configured manually.

**Examples of installable ACP-compatible agents:**

| Agent | Command | Notes |
|-------|---------|-------|
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `gemini --experimental-acp` | Experimental ACP flag |
| [Goose](https://github.com/block/goose) | `goose acp` | |
| [Docker cagent](https://github.com/docker/cagent) | `cagent acp agent.yml` | Container-based agents |

### Adding an agent

Open **Settings → ACP Agents**. The **Agent Store** tab lets you browse and install agents from the community registry with one click. The **My Agents** tab lets you create and manage custom agents — set the binary command, arguments, environment variables, and icon, or paste a JSON definition from your clipboard to auto-fill the form.

## MCP Servers

MCP servers are configured per project through the **MCP Servers panel** in the right-side toolbar. Supported transports: stdio, SSE, and HTTP. OAuth authentication is handled in-app with token persistence across sessions.

## Install

> [!NOTE]
> Pre-built binaries are currently **unsigned**. On macOS, right-click the app and choose **Open** to bypass the Gatekeeper warning on first launch. On Windows, click **More info → Run anyway** if Windows Defender flags the installer. If the project grows to support it through community donations, code signing certificates will be purchased for all platforms.

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | [`.dmg` (arm64)](https://github.com/OpenSource03/openacpui/releases/latest) |
| macOS (Intel) | [`.dmg` (x64)](https://github.com/OpenSource03/openacpui/releases/latest) |
| Windows (x64) | [`.exe` installer](https://github.com/OpenSource03/openacpui/releases/latest) |
| Windows (ARM64) | [`.exe` installer](https://github.com/OpenSource03/openacpui/releases/latest) |
| Linux | [`.AppImage`](https://github.com/OpenSource03/openacpui/releases/latest) / [`.deb`](https://github.com/OpenSource03/openacpui/releases/latest) |

## Development

```bash
git clone https://github.com/OpenSource03/openacpui.git
cd openacpui
pnpm install
pnpm dev
```

### Build installers

```bash
pnpm dist:mac      # macOS DMG (arm64 + x64)
pnpm dist:win      # Windows NSIS installer (x64 + ARM64)
pnpm dist:linux    # Linux AppImage + deb
```

## Contributing

1. Fork the repo and create a feature branch
2. Follow the conventions in `CLAUDE.md`
3. Test with `pnpm dev`
4. Open a pull request

## License

MIT

---

<p align="center">
  Built on the <a href="https://agentclientprotocol.com">Agent Client Protocol</a>
</p>
