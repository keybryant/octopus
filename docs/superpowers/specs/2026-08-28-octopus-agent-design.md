# octopus-agent — 工作台真实 Agent 会话插件 设计文档

- 日期：2026-08-28
- 状态：草案（供评审）
- 关联文档：`2026-08-25-octopus-workbench-design.md`（壳架构）、`2026-08-26-agent-homepage-v5.md`（v5 首页，AgentClient 选择缝）、`2026-08-28-octopus-tasks-design.md`（agent 执行非目标，本文档为其接缝续作）

## 目标

工作台首页的聊天已是 agent 形态（ChatPane/Composer/ArtifactsRail），但 `AgentClient` 是脚本化 mock（`web/src/lib/agent-client.ts`），只能按关键词返回预置脚本。本文档定义**真实 agent 会话接入**：新建 `octopus-agent` 服务端插件，用 dsh 运行时（AgentLoop + session + 工具 + 持久化）驱动真实 agent 会话；壳前端在既有 `AgentClient` 选择缝上接入 HTTP 客户端，插件缺失时优雅回退 mock（失败隔离）。

## 非目标（本次范围外）

- 平台工具注册（`list_tasks/claim_task/update_task/create_requirement/list_projects` 等 chat 联动工具）—— 独立后续阶段，本会话已具备 dsh 标准工具链（fs/pwsh/web search/todo/…）
- 任务卡「Agent 执行」按钮 headless 实际改码会话
- `ask_user_question` 与官方 dsh Web UI provider 的完整共存（见「用户提问与审批」的降级说明）
- 多用户会话隔离（multi-user 下会话全局共享，owner 维度留待后续）

## 平台事实（@deepseek-ai/dsh ^0.1.1-rc.2，web profile 组合 = dsh-base + dsh-web-app）

`pnpm dsh web` 下可用服务（均来自 dsh-base/`dsh-web-app` bundle 行）：

| 服务 | 提供者 | 用途 |
|---|---|---|
| `ctx.webServer` | `dsh-host-webserver`（id `webserver`） | REST/SSE 路由注册（`register({kind,path,handler})`） |
| `ctx.agents` | `dsh-agent` `AgentRegistry` | `create({sessionId, meta:{cwd,agentPreset}, agentOptions, setup})` / `resume({resumeSessionId, …})`，返回 `AgentHandle`（`agent` + `dispose()`） |
| `ctx.agentLoop`（factory 注入者） | `dsh-agent-loop` | 提供 AgentFactory 服务（不直接调用） |
| `ctx.sessions` | `dsh-session` `SessionStore` | 事件源 session 存储 |
| `ctx.sessionPersistence` | `dsh-session-persistence-jsonl`（root `$DSH_HOME/sessions`） | `listSnapshots()` / `load(id)` → `SessionInspection{meta,events}`（历史回放） |
| `ctx.agentDefaultModel` | `dsh-agent-default-model` | `currentSelection()` → `{provider, model}` 默认路由（配置默认 `deepseek-official`/`deepseek-v4-flash`，可被 settings 覆盖） |
| `ctx.tools` | `dsh-tools` | 工具注册（后续阶段用） |
| `ctx.userQuestions` | `dsh-user-questions` | `registerProvider()`（全局唯一 UI provider） |
| `ctx.approval`（`approval/request` waterfall，scope-filtered） | `dsh-user-approval` | 权限审批双向通道 |
| `dsh-agent-presets` | 预设（default `standard`） | `meta.agentPreset` 选择会话技能栈 |

关键事件（详情见 `dsh-session/lib/types/types.d.ts` 与 `dsh-agent/lib/types/runtime-types.d.ts`）：

- `user/message` / `assistant/message` / `tool/result`（surface 事件，各带 `seq`）
- `turn/start` / `turn/end {reason}` / `assistant/chunk`
- `approval/asked {id,toolName,reason}` / `approval/decided`（log-only 审计事件）
- `agent/status {status: 'idle'|'running'}`（agent-scope 事件）

## 架构

```
workbench web（React）
   │  AgentClient 缝：probe /api/octopus-agent/up → HttpAgentClient | 回退 MockAgentClient
   ▼
octopus-agent 插件（服务端，仅 API，无 web bundle）
   │
   ├─ AgentManager  Map<sessionId, Entry{ handle, bus }>
   │    ├─ create：ctx.agents.create({ sessionId: `oct-<rand>`, meta:{ cwd, agentPreset }, agentOptions })
   │    ├─ resume：open 历史时 ctx.agents.resume({ resumeSessionId, agentOptions, setup })
   │    ├─ 注册 agent.scope 内 session/event + agent/status + approval/request 监听 → bus
   │    └─ idle-ttl 回收（dispose handle；持久化日志保留）
   ├─ project.ts  纯投影：SessionEvent → 传输事件（历史 + SSE 共用同一投影）
   ├─ bus.ts      每会话事件环形缓冲 + SSE 订阅者
   └─ handlers    审查/路由（请求体校验沿用 octopus-projects 的 ApiError 模式）
```

### 传输事件协议（`/api/octopus-agent` 唯一线上契约）

```ts
export type AgentStreamEvent =
  | { type: "status"; status: "idle" | "running" }
  | { type: "user-message"; text: string }
  | { type: "assistant-text"; text: string }
  | { type: "tool-call"; callId: string; name: string; summary: string }
  | { type: "tool-result"; callId: string; ok: boolean; preview: string }
  | { type: "turn"; at: "start" | "end"; reason?: string }
  | { type: "title"; title: string }
  | { type: "question"; id: string; question: string; options?: string[] }
  | { type: "approval"; id: string; toolName: string; reason?: string }
  | { type: "error"; message: string }
```

- 在线：SSE `GET /sessions/:id/events`（`data: JSON` + `id: seq`），`after` 查询参数从事件缓冲续传
- 历史：`GET /sessions/:id/history` → `{ session, events: AgentStreamEvent[] }`（由 `sessionPersistence.load()` + `project.ts` 重建，无需复活 agent）
- tool-call/tool-result 按 `callId` 关联：投影工具内维护 `Map<callId, name>`（assistant/message 的 tool-call 块先至，tool/result 后至）

## 服务端 API（base = `/api/octopus-agent`）

| 方法/路径 | 请求体 | 响应 | 说明 |
|---|---|---|---|
| `GET /up` | — | `{ ok: true }` / 503 | 壳探测；也用于插件降级判定 |
| `POST /sessions` | `{ cwd?, agentPreset?, provider?, model? }` | `{ session }` | 创建会话；cwd 缺省 `config.defaultCwd ?? process.cwd()`；必须绝对路径否则 400 |
| `GET /sessions` | — | `{ items: SessionMeta[] }` | 持久化快照列表（`id, createdAt, cwd`，无标题事件时 title 取 `session-<id>` 前缀）；按 createdAt 倒序 |
| `GET /sessions/:id/history` | — | `{ session: SessionMeta, events: AgentStreamEvent[] }` | 实时 + 持久化两路取数；不存在 → 404 |
| `GET /sessions/:id/status` | — | `{ live, status?, pendingQuestionId?, pendingApprovalId? }` | 前端轮询补齐（SSE 断线场景） |
| `POST /sessions/:id/messages` | `{ text, answerQuestionId?, approvalDecision? }` | `{ ok: true }` | followup 发消息；`answerQuestionId`/`approvalDecision` 二选一升级为回答问题/审批 |
| `POST /sessions/:id/cancel` | — | `{ ok: true }` | `agent.cancel('user')` |
| `DELETE /sessions/:id` | — | `{ ok: true }` | cancel + dispose；持久化日志保留（历史仍可见） |
| `POST /sessions/:id/approvals/:approvalId` | `{ decision: "allow" | "deny" }` | `{ ok: true }` | 回答审批 |

错误统一 `{ error }` + 状态码（400 校验 / 404 会话不存在或已 dispose / 409 会话 id 冲突 / 503 agent-loop 不可用、provider 未注册或持久化未就绪）。

### 用户提问与审批（v1 边界）

- **审批**：`agent.ctx.on('approval/request', …)`（scope-filtered，不与官方 UI 冲突）。监听器投递 SSE `approval` 事件，挂起 Promise，`POST /sessions/:id/approvals/:approvalId` 的 `allow`/`deny` 触发 `next()` 返回 `ApprovalOutcome`；会话取消/销毁时以 `'cancelled'` 兜底。
- **用户提问**：`ctx.userQuestions.registerProvider()` 是全局单例（官方 dsh Web UI 在其会话上注册）。v1 策略：仅当当前无注册 provider 时注册（try/catch），成功则该类问题走 SSE `question` + `POST /sessions/:id/messages { answerQuestionId }`；注册失败则以 log 忽略（官方 UI 无法接管本插件会话时，ask_user_question 工具会挂起，作为已知降级写 README）。
  - 因此 agent `setup` 内**不**改变任何权限策略：沿用 `sandbox-policy` 的 `workspace-write` + approval `ask`（web 组合默认），保证危险操作有人类闸门；审批通道即 README 中「反向代理」同级的部署注意点。

### 机器人会话生命周期

- 创建即注册 session/event 投影监听；ticket：`oct-<8位随机大写字母数字>`（与 `session-<n>` 策略区分），冲突/创建失败 → 409/503。
- `idleTtlMs`（默认 30 分钟，0=常驻）：无 SSE 订阅者且 agent 状态 idle 超时 → `dispose()`；列表与历史仍可读（resume 按需复活）。
- 服务端重启后：仅持久化日志存活，打开历史会话时 `resume` 复活（前提 `llm` 路由仍可用，否则 503）。
- 会话删除 = 只删活体；持久化日志清理不在本次范围（同 dsh web 行为）。

## 前端（壳包，仅 `packages/octopus/web`）

### AgentClient 缝扩展（关键契约保持不变，驱动升级）

`web/src/lib/agent-client.ts` 现有接口是 `reply(input)` 一次成型；真实会话需要流式。**升级为事件驱动的双实现接缝**（mock 同步适配，降低 test 破坏面）：

```ts
// web/src/lib/agent-client.ts（定义 + mock 实现不变语义）
export interface AgentClient {
  /** 在后台/历史会话中创建 agent 会话（mock 时 no-op，返回 'mock'） */
  startSession(opts?: { cwd?: string }): Promise<string>
  /** 会话消息；跟 SSE/历史装订 */
  subscribe(handler: (ev: AgentStreamEvent) => void): () => void
  send(text: string): Promise<void>
  history(sessionId: string): Promise<AgentStreamEvent[]>
  listSessions(): Promise<SessionMeta[]>
  switchTo(sessionId: string): void
  cancel(): Promise<void>
  disposeSession(): Promise<void>
  answerApproval(id: string, decision: "allow" | "deny"): Promise<void>
}
```

`createMockAgentClient`：`startSession`/`subscribe`/`send` 用现有脚本化事件发射（PRIORITY_SCRIPT 拆成 sequence of events 等时长异步派发；无 question/approval）；`createDefaultAgentClient()` 先 `GET /api/octopus-agent/up`（fetch + AbortController 1.5s 超时），成功 → `createHttpAgentClient()`，失败 → mock（壳可独立）。

依赖注入保持：App.tsx `useMemo(createDefaultAgentClient, [])`；组件层（ChatPane/ArtifactsRail）不感知实现。

### 消息渲染映射（新 block 类型）

`MessageBlock` 联合类型新增：

```ts
export type MessageBlock =
  | "paragraph" | "bullets" | "steps" | "cards" | "actions" | "code" | "notice"  // 既有
  | { kind: "approval"; approvalId: string; toolName: string; reason?: string }   // 新增
```

真实事件 → ChatMessage 块映射：

| AgentStreamEvent | 渲染 |
|---|---|
| `assistant-text` | `paragraph`（按 `\n` 拆多段） |
| `tool-call` | `notice`（title=tool 名，hint=summary 前 160 字符） |
| `tool-result` ok | 并入上一条 notice（不新增块）；`!ok` → 追加 danger tone `notice`（preview ≤200 字符） |
| `question` | `notice` + 输入区占位「回答 Agent 的问题…」；send 时自动带 `answerQuestionId` |
| `approval` | 新增 `approval` 块：按钮「允许」「拒绝」（onDecision 回调 → `answerApproval`） |
| `status` vs `turn/start` | thinking 光标切换 |

ArtifactsRail：真实会话的产出 = `tool-call` 中 `todo_write` / `str_replace_editor` / `write_file` 事件投影为 `task`/`doc` artifact 条目（`kind` 映射：todo→task，编辑→doc；本次不追踪 commit）。mock 仍按脚本返回。

### 会话切换器

ChatPane 头部当前「历史会话」按钮 → 升级为下拉（octopus-ui DropdownMenu）：`listSessions()` 列表 + 「新建会话」（创建后自动 switch，cwd 取 App 当前项目 `workspacePath`，无项目时省略 cwd）。切历史会话 → `history()` 全量重放 + `subscribe` 续传（UI 复用同一消息数组，清空重启）。

## 配置（octopus-agent 插件）

```ts
Config = z.object({
  defaultCwd: z.string().optional(),          // session 创建时未指定 cwd 的回退（须绝对路径）
  defaultAgentPreset: z.string().default("standard"),
  provider: z.string().optional(),            // 覆盖 ctx.agentDefaultModel.currentSelection()
  model: z.string().optional(),
  idleTtlMs: z.number().default(30 * 60 * 1000), // 0 = 永驻
})
```

## 插件包规格

- 包名 `octopus-agent`，插件 id `octopus-agent`；`inject = ["webServer", "agents", "sessionPersistence"]`（webServer 必须；其余 resolve 失败 → `up` 返回 503 并在启动时 log 明示）
- `cordis.patch.yml`：`insert: [{ id: octopus-agent, name: octopus-agent }]`
- **无 web/ 目录**（纯服务插件，不注册 workbench 模块；壳通过 /up 探测而非模块注册表）
- `package.json` deps：`@deepseek-ai/schemastery`；peerDeps：`@deepseek-ai/cordis`
- devDeps：`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-session-persistence`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-user-approval`（类型引用走 dsh 安装闭包的 flat fallback；声明 types 依赖便于独立构建）
- 根 `package.json` dev/dev:noopen 脚本追加 `./packages/octopus-agent`
- README 增加：依赖 `pnpm dev` 一键挂载；降级说明（无插件 → mock 聊天）；ask_user_question 与官方 UI provider 的单例冲突说明

## 文件名与职责

```
packages/octopus-agent/
├── package.json / tsconfig(.build).json / vitest.config.ts / cordis.patch.yml / README.md
└── src/
    ├── index.ts          # 插件入口：路由注册 + 依赖守卫 + 配置
    ├── api.ts            # createAgentApi(deps)：API handler（Node req/res，仿 octopus-projects）
    ├── manager.ts        # AgentManager：create/resume/dispose/status/idle-ttl
    ├── bus.ts            # SessionBus：环形缓冲 + SSE 订阅/重连 after 游标
    ├── project.ts        # projectEvents(events, state?) → AgentStreamEvent[]；纯函数
    └── 各文件 .test.ts    # 单测
```

## 测试策略

- 服务端纯单测（vitest，不拉起 dsh 运行时）：
  - `project.ts`：合成 session 事件（user/message、assistant/message 含 text+tool-call、tool/result、turn/start end、approval/asked）→ 断言投影事件
  - `bus.ts`：环形缓冲游标续传、订阅/退订、SSE 格式输出
  - `manager.ts`：fake `agents`/`sessions`/`sessionPersistence` service（ctx 内 provide stub）——create/resume/重复 id/dispose/idle ttl 触发
  - `api.ts`：mock req/res 覆盖各路由 + 错误码（仿 octopus-projects api.test.ts）
- 壳前端：`agent-client` 的新实现（http client + mock 演化）单测（mock fetch/EventSource）、useChat 适配测试、ChatPane 集成（注入 mock client）、App 集成（up 探测 mock 即可）
- 手工冒烟（`pnpm dev:noopen`）：`http://127.0.0.1:3080/workbench`——真实问答需要 `DEEPSEEK_API_KEY` 环境变量或 `$DSH_HOME/settings.yaml` 的 `llm-deepseek:` 段（README 已述）；验证：新建会话 → 发消息 → 思考态 → 文本消息出、工具调用以 notice 呈现 → 收起重开 → 历史恢复 → approve/deny 审批通道在写文件等操作时出现 → 删除会话后列表仍见历史
- 验收命令（仓库根）：
  - `pnpm --filter octopus-agent test` / `pnpm --filter octopus-agent build`
  - `pnpm --filter octopus exec vitest run --root web`
  - `pnpm --filter octopus exec tsc -p web/tsconfig.json --noEmit`

## 后续迭代（非本次范围）

- 平台工具注册（projects/requirements/tasks → `ctx.tools.register`），chat 联动
- `ask_user_question` 冲突解决：会话级 provider 迁移或独立问题域
- multi-user 会话 owner 字段与用户级隔离
- 会话持久化清理 / 归档 / 导出
