# Harnss Release Notes Template

## Title Format

`v{X.Y.Z} — Short Descriptive Phrase`

- Use an em dash (`—`), not a hyphen
- Name 2-3 headline features, joined by commas and `&`
- Examples:
  - `v0.15.0 — Slash Commands, Tool Grouping & Project Files`
  - `v0.14.0 — Codex Engine Config, Auth Flow & Settings Refresh`
  - `v0.13.1 — Windows Compatibility Fixes`

## Notes Structure

```markdown
## What's New

### {emoji} {Category Title}
- **{Feature name}** — description of what it does
- **{Feature name}** — description

### {emoji} {Category Title}
- **{Feature name}** — description

---

**Full Changelog**: https://github.com/OpenSource03/harnss/compare/v{prev}...v{current}
```

## Rules

1. Use `## What's New` for feature releases, `## Changes` for patch/fix-only releases
2. Group under `### {emoji} {Category Title}` headers
3. Bullets: `**bold feature name** — description` (em dash)
4. End with `---` separator and Full Changelog link

## Emoji Conventions

| Emoji | Category |
|-------|----------|
| ⚡ | Performance, speed, commands, autocomplete |
| 📦 | Grouping, packaging, bundling |
| 📂 | Files, filesystem, project structure |
| 🔍 | Search, inspection, debugging |
| 📨 | Messages, queues, communication |
| 🛠 | Tools, subagents, integrations |
| 🎨 | UI, polish, visual changes, icons |
| ⚙️ | Configuration, settings, engines |
| 🔐 | Auth, security |
| 🔄 | Updates, syncing, auto-refresh |
| 🌳 | Git, worktrees, version control |
| 🐛 | Bug fixes |
| ✨ | New features (generic) |

## Example: Feature Release (v0.15.0)

```markdown
## What's New

### ⚡ Slash Command Autocomplete
- **Unified `/` command picker** in InputBar — type `/` to browse commands from Claude, ACP, and Codex engines
- **Keyboard navigation** with arrow keys, Enter/Tab to select, Escape to dismiss

### 📦 Tool Group Collapsing
- **Automatic grouping** — contiguous tool_call sequences merge into a collapsible summary block
- **Animated morph transition** — tools compress into a grouped header with staggered row animations

### 📂 Project Files Panel
- **Full filesystem tree browser** — walks entire project directory (skips .git, node_modules)
- **Search filtering** with debounced input and auto-expand matching directories

### 🎨 UI & Polish
- **App icon refresh** — display-p3 gradient, dark/light opacity specializations
- **SDK bump** to `@anthropic-ai/claude-agent-sdk` 0.2.68

---

**Full Changelog**: https://github.com/OpenSource03/harnss/compare/v0.14.3...v0.15.0
```

## Example: Patch Release

```markdown
## Changes

### 🐛 Windows Compatibility
- **Windows ARM64 binary detection** — fixed Codex binary path resolution for ARM64 Windows
- **npm pack EINVAL workaround** — handle Windows-specific EINVAL error during npm pack

---

**Full Changelog**: https://github.com/OpenSource03/harnss/compare/v0.13.0...v0.13.1
```
