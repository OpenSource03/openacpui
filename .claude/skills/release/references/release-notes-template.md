# Harnss Release Notes Template

## Title Format

`v{X.Y.Z} — Short Descriptive Phrase`

- Use an em dash (`—`), not a hyphen
- Name 2-3 headline features, joined by commas and `&`
- Examples:
  - `v0.21.0 — Virtualized Chat, Mermaid Diagrams & Deep Folder Tagging`
  - `v0.15.0 — Slash Commands, Tool Grouping & Project Files`
  - `v0.14.0 — Codex Engine Config, Auth Flow & Settings Refresh`
  - `v0.13.1 — Windows Compatibility Fixes`

## Audience & Tone

**Write for users, not developers.** Release notes are read by people who use the app, not people who built it.

- ✅ "Long conversations are dramatically faster now"
- ❌ "Replaced `content-visibility: auto` with `@tanstack/react-virtual` windowing"
- ✅ "When Claude draws a diagram, it now actually renders as a visual diagram"
- ❌ "Mermaid fenced code blocks render as SVG via async `mermaid.render()` with LRU cache"
- ✅ "Type `/clear` in the composer and hit Enter to open a fresh chat"
- ❌ "Added `LOCAL_CLEAR_COMMAND` slash command with `source: 'local'` that calls `onClear()` callback"

**Rules of thumb:**
- Describe what the user *experiences*, not what the code does
- No internal names, no version numbers, no API terms, no implementation details
- If you can't explain it in plain English, simplify or skip it
- Bug fixes: describe the symptom the user saw, not the root cause

## Notes Structure

Sections can be free-form paragraphs OR bullet lists — pick whichever reads more naturally.

```markdown
## What's New

### {emoji} {User-Facing Section Title}
Short paragraph explaining what changed and why users care.

### {emoji} {User-Facing Section Title}
- **{Feature name}** — what it does for the user
- **{Feature name}** — what it does for the user

### 🐛 Bug Fixes
- Fixed a bug where [symptom the user experienced]
- Fixed [thing] that caused [user-visible problem]

---

**Full Changelog**: https://github.com/OpenSource03/harnss/compare/v{prev}...v{current}
```

## Rules

1. Use `## What's New` for feature releases, `## Changes` for patch/fix-only releases
2. Group under `### {emoji} {Category Title}` headers — keep titles plain, not technical
3. End with `---` separator and Full Changelog link
4. **Always write for users first.** Internal details, library names, and implementation notes belong in commit messages and CLAUDE.md, not release notes.

## Emoji Conventions

| Emoji | Category |
|-------|----------|
| ⚡ | Performance, speed, snappiness |
| 📦 | Grouping, packaging |
| 📂 | Files, folders, filesystem |
| 🔍 | Search, inspection |
| 📨 | Messages, queues, communication |
| 🛠 | Tools, integrations |
| 🎨 | UI, visual polish |
| ⚙️ | Settings, configuration |
| 🔐 | Auth, security, permissions |
| 🔄 | Updates, syncing |
| 🌳 | Git, version control |
| 🐛 | Bug fixes |
| ✨ | New features (generic) |

## Example: Feature Release (v0.21.0)

```markdown
## What's New

### ⚡ Much Faster Chat
Long conversations are dramatically faster now. We replaced the old rendering approach with a proper virtualized list — only the messages you can actually see are rendered at any time. Scrolling is smoother, switching sessions is snappier, and the app uses less memory overall.

### 📊 Mermaid Diagrams
When Claude draws a diagram using a mermaid code block, it now actually renders as a visual diagram — flowcharts, sequence diagrams, pie charts, git graphs, and more. Diagrams adapt to your light/dark theme automatically. While Claude is still typing, you see the raw source; once the message is complete, the diagram appears.

### 📂 Deep Folder Inclusion (`@#`)
You can now use `@#foldername` in the composer to include the full contents of a folder — not just the file tree, but every file inside it. Regular `@folder` still gives you the structure overview. If the folder is large, Harnss will warn you before sending.

### ⌨️ `/clear` Command
Type `/clear` in the composer and hit Enter to instantly open a fresh chat — without sending anything to the agent.

### 🐛 Bug Fixes
- Fixed a bug where switching out of plan mode could reset the permission level incorrectly
- Fixed markdown characters occasionally getting eaten during streaming (apostrophes, backticks, etc.)
- Permission prompts now show a notification if something goes wrong, instead of failing silently

---

**Full Changelog**: https://github.com/OpenSource03/harnss/compare/v0.20.0...v0.21.0
```

## Example: Patch Release

```markdown
## Changes

### 🐛 Bug Fixes
- Fixed the app hanging when switching sessions during an active stream
- Fixed copy button not working in certain sandboxed contexts

---

**Full Changelog**: https://github.com/OpenSource03/harnss/compare/v0.21.0...v0.21.1
```
