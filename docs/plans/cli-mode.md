# Harnss CLI 模式（"Claude CLI 会话管理器"方向）

## 背景与动机

当前 Harnss 通过 `@anthropic-ai/claude-agent-sdk` 直接驱动会话。
SDK 模式给了 Harnss 结构化事件流和 rich tool 渲染，但带来一组限制：

- CLI-only slash 命令不可用（`/mcp` `/login` `/cost` `/doctor` `/init` `/status` `/upgrade` 等）
- 配置自动发现（`~/.claude/settings.json` 链、`CLAUDE.md` 链、`.claude/agents/`、`.claude/commands/`）要 app 自己重做
- 登录、计费、订阅、CLI 自升级 全部 app 自管
- MCP 必须 app 喂给 SDK，无法复用用户在 CLI 里配的 MCP

用户实际工作流偏向 terminal — alias 已是
`claude --dangerously-skip-permissions --teammate-mode in-process --enable-auto-mode`，
即把 CLI 当主力工具用。Harnss 的核心价值点其实是 **session 管理**，
不是"美化过的 chat UI"。

## 目标

把 Harnss 的定位从"基于 SDK 的独立 chat 客户端"调整为：

**Claude CLI 的会话管理 / 终端宿主**——

- 每个 Harnss session = 一个 pty 跑 `claude --resume <uuid>` 或 `claude --session-id <uuid>`
- chat 视图就是 xterm.js 渲染的 CLI TUI
- Harnss 提供 CLI 不提供的能力：跨 cwd 全局会话浏览、批量管理、归档、
  搜索、组合面板（terminal + browser + git + files）

## CLI 提供的钩子（已确认可用）

CLI 一级参数：

```
--session-id <uuid>     用指定 ID 启动新会话
--resume <id>           按 ID 恢复
--fork-session          恢复时另起新 ID（保护原会话）
--name <name>           设置 session 显示名
--continue              当前 cwd 最近一个
--from-pr [value]       按 PR 恢复
--add-dir <dirs...>     额外允许目录
--agent <agent>         指定 agent
--mcp-config <files...> MCP 配置文件
--permission-mode       acceptEdits | auto | bypassPermissions | default | dontAsk | plan
```

CLI 自维护索引：

```
~/.claude/projects/{hash}/sessions-index.json
{
  "version": 1,
  "entries": [
    {
      "sessionId": "uuid",
      "fullPath": ".../{uuid}.jsonl",
      "fileMtime": 1769808016486,
      "firstPrompt": "...",
      "summary": "...",
      "messageCount": 25,
      "created": "ISO",
      "modified": "ISO",
      "gitBranch": "",
      "projectPath": "/abs/path",
      "isSidechain": false
    }
  ]
}
```

→ **Harnss 不需要 reverse-engineer hash**，扫描所有 sessions-index.json 即可。

## 架构方案

### Engine 抽象

新增第四种 engine：`cli`（与现有 `claude` / `acp` / `codex` 并列）。

```
src/types/engine.ts:
  EngineId = "claude" | "acp" | "codex" | "cli"
```

`cli` engine 的实现：

- main: 复用 `electron/src/ipc/terminal.ts` 的 pty 框架
  - 新文件 `electron/src/ipc/cli-sessions.ts` 在 pty 之上做 session 语义封装
  - `cli:start({ sessionId?, cwd, resume?, model?, permissionMode? })` →
    spawn `claude` 带相应参数，返回 pty terminalId 和真实 sessionId（spawn 后从
    `~/.claude/projects/{hash}/sessions-index.json` 读最新 entry）
  - `cli:list-sessions({ cwd? })` → 扫所有 / 单 cwd 的 sessions-index.json
  - `cli:fork-session(sessionId)` → spawn `claude --resume <id> --fork-session`
  - `cli:rename-session(sessionId, name)` → 写 metadata（CLI 没有改名 API，
    Harnss 自己存到 `{userData}/openacpui-data/cli-meta.json`）

- renderer:
  - `useCliSession` hook（薄层）：维护 terminalId + 当前 sessionId
  - chat 面板由 xterm.js 直接渲染（复用 TerminalPanel 的实现）
  - 不再走 SDK 的 message/tool_call/result 事件流

### Session browser（核心增值）

新增 `<GlobalSessionBrowser>` 面板（侧边栏 / cmd+P 弹窗）：

- 数据源：`cli:list-sessions`（聚合所有 cwd 的 sessions-index.json）
- 字段：firstPrompt 摘要、gitBranch、projectPath、最后修改时间、消息数
- 操作：
  - **Open** → 在新 pty 里 `claude --resume <id>`
  - **Fork** → `claude --resume <id> --fork-session`
  - **Archive** → 移动 JSONL 到 `~/.claude/projects/{hash}/.archived/`
  - **Search** → 全文 grep JSONL（匹配 user/assistant 文本）
  - **Filter** → 按 cwd / branch / 最近 N 天 / 消息数

CLI 现有 `--resume` 弹的 picker 只在当前 cwd 内搜，**Harnss 的增值就是跨 cwd 全局浏览**。

### 保留的 Harnss 增值组件

下面这些与 chat 引擎正交，CLI 模式照样能用：

- 终端面板（多 tab pty） — 还是现在那套
- 浏览器面板（webview）
- Git 面板
- Files 面板
- Grab 元素持久化
- Composer draft 持久化（适配：保存到 cli-meta.json，pty 还原时 prefix paste）
- Space / Project 概念（作为 cwd grouping）
- Archive sessions（用 JSONL 移动实现）
- Import session by UUID（已有，CLI 模式下意义更大）

### SDK 模式的去留

**两条路线选一**：

**路线 A：CLI 模式取代 SDK 模式**
- 直接删掉 `electron/src/ipc/claude-sessions.ts` + 渲染端 `useClaude`
- 优点：codebase 减重 ~40%，维护负担骤降
- 风险：tool renderers（Jira / Edit / Task）失去结构化数据源，全部回退到 ANSI

**路线 B：CLI 模式 + SDK 模式并存**
- 用户在新建 session 时选 engine（已经有 ACP / Codex 共存的先例）
- 优点：rich tool UI 保留给"研究模式"，重度日常用 CLI 模式
- 风险：双倍维护成本，UX 容易让用户困惑

**初步倾向：路线 B**，先以 CLI engine 形式增量验证，
跑一段时间后看 SDK 模式还有没人用，再决定是否清理。

## Phase 划分

### Phase 0 — 探针（1 天）

无需动 codebase，仅确认假设：

- [ ] 在现有 TerminalPanel 里手动跑 `claude --session-id $(uuidgen)`，
      确认 pty 能完整渲染 CLI TUI（颜色、TUI 折叠、permission prompt 都正常）
- [ ] 跑完一个 session 后，确认 `sessions-index.json` 出现新 entry
- [ ] 用 `claude --resume <id>` 在新 pty 里恢复，确认体验完整

**验收**：体验对比 iTerm 跑 CLI 无差异。
**如失败**（如 PTY emulation 不够，prompt 错乱）→ 整个方向作废。

### Phase 1 — CLI engine 骨架（2-3 天）

- [ ] `electron/src/ipc/cli-sessions.ts`：spawn / list / fork / archive
- [ ] `useCliSession` hook
- [ ] 新建会话 UI 加 "CLI Mode" engine 选项
- [ ] CLI session 的 chat 面板用一个全屏 xterm.js 实例
- [ ] 切换 session = 切 pty 焦点（保持后台 alive，与现有 terminal 一致）

**验收**：能在 Harnss 内创建 CLI session、切换、恢复，体验等同 iTerm 跑 CLI。

### Phase 2 — Global session browser（2-3 天）

- [ ] 扫所有 sessions-index.json 的 main IPC
- [ ] 侧边栏新增 "All Sessions" 视图（在现有 Project list 之上）
- [ ] cmd+P 全局 session 切换器
- [ ] 搜索 / 过滤 / 排序
- [ ] Open / Fork / Archive 操作

**验收**：跨 50+ session、跨 10+ cwd 的浏览体验流畅。

### Phase 3 — Composer 持久化适配（1-2 天）

CLI 模式下没有 React 受控的 composer，怎么实现"切走再回来文字还在"：

方案：Harnss 拦截 cmd+enter / 普通 Enter 之外的输入，
进入"编辑暂存"模式（一个浮在 pty 上方的文本框），切换 session 时把文本存 cli-meta.json，
切回时再渲染。提交时把暂存内容 paste 进 pty（`pty.write(text + "\r")`）。

也可以更激进：直接监听 pty 输出，截获 CLI 的输入框 ANSI 区域，
但这太脆弱，跟 CLI 渲染绑死。

**默认方案**：Harnss 浮层 composer + paste。

### Phase 4 — SDK 模式取舍（1 天决策）

跑 1-2 周，看：
- CLI session 占新建的比例
- tool renderer 缺失体感是否强烈
- 是否有用户依赖 SDK 模式独有功能

数据驱动决定路线 A / B。

## 并行执行图

不是所有 Phase 都互锁。下面拆开看运行时并行（两 engine 共存）和开发时并行（多 track 同时推进）。

### 运行时并行：能共存吗？

**结论：可以**。两 engine 在数据、状态、UI 三个层面都能干净分离。

```
                    Harnss App
                        |
        +---------------+---------------+
        |               |               |
   shared layer    SDK engine     CLI engine
   (common)        (existing)     (new)
        |               |               |
+-------+-----+   +-----+-----+   +-----+-----+
| Sidebar     |   | useClaude |   | useCli    |
| ProjectList |   | claude-   |   | cli-      |
| Settings    |   |  sessions |   |  sessions |
| TerminalPnl |   | rich tool |   | xterm     |
| BrowserPnl  |   |  renderer |   |  fullscr  |
| GitPanel    |   | React     |   | pty in/out|
| FilesPanel  |   |  composer |   | paste     |
| Grab        |   | perm UI   |   | perm in   |
+-------------+   +-----------+   +-----------+
                        |               |
                        v               v
                  React state     pty + JSONL
                  + JSON files    (~/.claude/
                  ({userData}/    projects/)
                   openacpui-
                   data/)
```

**共享层（与 engine 无关）**：Sidebar / ProjectList / Settings / TerminalPanel / BrowserPanel / GitPanel / FilesPanel / Grab / Space / Archive UI / Notifications。这些组件按 sessionId / projectId scope，不在乎 session 跑在哪个 engine 上。

**SDK 特化**：useClaude / claude-sessions.ts / 所有 tool-renderers / mcp-renderers / React message list / contentEditable composer / permission React prompt / BackgroundSessionStore。

**CLI 特化**：useCliSession / cli-sessions.ts / 全屏 xterm chat 视图 / 浮层 composer / pty in 的 permission（CLI 自己渲染）/ sessions-index 全局浏览。

**数据互不互通**：

| | SDK session | CLI session |
|---|---|---|
| 存储 | `{userData}/openacpui-data/sessions/{projectId}/{id}.json` | `~/.claude/projects/{cwdHash}/{id}.jsonl` |
| 主键 | Harnss 自己生成的 sessionId | CLI 生成的 UUID |
| 互转 | 不可（消息格式差异大；CLI 模式下 tool_call ANSI 化） | 不可（同上） |
| Session 列表 | 共存于 sidebar，每条带 engine badge | 同左 |

**用户能切吗**：在新建会话时选 engine（与 ACP / Codex 现状一致），已存在的 session 锁定 engine。

### 开发时并行：怎么拆 track？

下面三条 track **可以从今天起同时推进**，仅在 Phase 1 收尾时合流一次。

#### Track A — CLI 路线（关键路径）

```
Phase 0 探针 (1d)  ─►  Phase 1 CLI engine 骨架 (2-3d)  ─►  Phase 3 Composer 适配 (1-2d)
                                                          │
                                                          └─►  Phase 4 决策 (1d, 1-2 周后)
```

阻塞下游：Phase 0 失败则 A/C 全部作废。

#### Track B — Global Session Browser（独立增值，**可独立完成、独立合并**）

```
Phase 2 (2-3d) ──── 不依赖 CLI engine
```

**关键洞察**：sessions-index.json 是 CLI 自己维护的，**即使不做 CLI engine**，
Harnss 也能立刻给现有 `cc-sessions:import`（PR #7 引入）一个真正的浏览 UI。
今天就能做、今天就能 merge、今天就能用。在 SDK 模式下，
Browser 列出的 session "Open" 操作走 import 流程；
CLI engine 上线后，"Open" 默认改为在 pty 里 `claude --resume`。

→ **Track B 没有任何依赖**，强烈建议先做 / 同步做。

#### Track C — 共享层抽象（铺路）

为了让 CLI engine 干净接入，先抽象几个 chat 视图层接口：

- [ ] `ChatRouter`：按 session.engine 决定渲染 React message list 还是 xterm 全屏
- [ ] `Composer` 抽象出 `ComposerHandle = { focus, insertText, getDraft, setDraft }`，SDK 用 contentEditable 实现，CLI 用浮层 textarea + paste 实现
- [ ] `PermissionGate`：SDK 用 React prompt，CLI 用 noop（pty 内）
- [ ] EngineId 类型加 `"cli"`

这些是纯重构，**对现有功能零行为变化**，可独立 merge。
完成后 Phase 1 接入 CLI engine 时几乎只剩业务实现。

### 时间表（理想路径）

```
Week 1
  Day 1   ─ Phase 0 探针 (Track A) + Track C 启动 (并行)
  Day 2-3 ─ Track B Phase 2 完成（Global Session Browser 可单独 merge）
  Day 3-4 ─ Track C 抽象层 merge
  Day 5   ─ Track A Phase 1 实施（依赖 C 已就绪）

Week 2
  Day 1-2 ─ Phase 1 收尾 + Phase 3 Composer 适配
  Day 3-5 ─ 实际使用、收数据

Week 3
  ──────── Phase 4 决策（A: 砍 SDK / B: 长期并存）
```

**最快可见用户价值**：Day 3 即有 Global Session Browser 进 master，与现有 SDK 模式独立工作。
**完整 CLI 模式**：Day 8 左右。

### 串行不可绕开的点

- **Phase 0 → Phase 1**：探针未通过则 Phase 1 整个不做
- **Track C → Phase 1**：抽象层先 merge，避免 Phase 1 边做边改 SDK 路径引发回归
- **Phase 1 → Phase 3**：Composer 适配建立在 Phase 1 渲染骨架上

### 不阻塞的"自由项"

- Phase 2 Global Session Browser
- Track C 抽象层（不动行为）
- 现有 SDK 模式的 bug 修复 / 小改进
- 文档与 plan 维护

## 风险与不确定项

| 风险 | 严重度 | 缓解 |
|---|---|---|
| PTY emulation 不能完整渲染 CLI TUI（如 permission prompt 弹窗） | 高 | Phase 0 先验，失败即放弃 |
| sessions-index.json 格式 CLI 升级时变化 | 中 | 写 schema 校验，破时降级到扫 .jsonl |
| 跨 cwd session 很多时索引扫描慢 | 中 | 缓存 + watch | 
| Composer paste 在 CLI 输入框边界异常（如多行、IME） | 中 | Phase 3 多场景测试 |
| 用户混用 CLI 模式和 SDK 模式数据不互通 | 低 | UI 明确区分；CLI session 不能被 SDK 引擎打开（反之亦然） |
| 失去 PostHog 错误捕获覆盖（CLI 内部错误进 pty 文本） | 低 | 解析 CLI debug log 文件 |

## Open Questions

1. **Permission prompt UX**：CLI 在 pty 内弹 permission，Harnss 是不是要拦截 ANSI、改成 native UI？还是接受 CLI 原生？
   - 倾向：第一版接受 CLI 原生，避免脆弱解析
2. **MCP 配置**：CLI 模式下 Harnss 还要不要管 MCP 配置 UI？
   - 倾向：不管。直接打开 `~/.claude.json` 让用户自己改，或者 spawn `claude /mcp` 在 pty 里
3. **Cost / usage 显示**：CLI 模式下怎么拿到 cost？
   - 选项 A：解析 pty 输出里 CLI 自己打印的 cost 行
   - 选项 B：定期 spawn `claude --print "/cost"` 查询（重）
   - 倾向：A
4. **Background sessions**：Harnss 当前 BackgroundSessionStore 让非 active session 的事件累积。CLI 模式下 pty 就是状态，自然累积——是否完全砍掉这套？
   - 倾向：是。CLI engine 不走 background store。

## 与现有计划关系

- 不影响 `session-scoped-tools.md` 设计——tool panel 仍按 sessionId scope
- Composer draft 持久化已实现的部分（PR #8）在 CLI 模式下要适配（Phase 3）
- Archive sessions（PR #5）在 CLI 模式下要换实现（移动 JSONL 而非改 React state）
- Import session by ID（PR #7）在 CLI 模式下成为一等公民

## 决策点

进入实施前需要明确：

- [ ] 路线 A 还是路线 B（取代 SDK 还是并存）
- [ ] Phase 0 探针先做，再决定 Phase 1+
- [ ] Phase 3 Composer 持久化是否接受"浮层 + paste"方案
