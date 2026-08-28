# octopus-workflow — Agent 需求→任务→子会话编排 设计文档

- 日期：2026-08-29
- 分支：feature-task（基于 dev 955dae7）
- 状态：草案，待评审

## 背景与定位

工作台已具备：需求域（`octopus-requirements`，`source: "chat"` 字段已预留）、任务域（`octopus-tasks`，需求拆解 + 看板）、真实 Agent 会话（`octopus-agent`，dsh AgentLoop + SSE + 审批桥）。三者在数据上无关联，agent 只能聊天，不能操作需求/任务。

`2026-08-28-octopus-agent-design.md` 已把「平台工具注册（`create_requirement` / `list_tasks` / `claim_task` 等 chat 联动工具）」列为明确的后续阶段；`octopus-tasks` 设计文档同样注明「真实 LLM 拆解替换 `generateTaskDrafts`、agent 执行（工具注册/执行引擎）后继接入」。

本插件 `octopus-workflow` 落地该阶段：**主 agent 在聊天中创建/查询需求 → 将需求拆解为任务并保存 → 为每个任务创建独立 headless 子会话执行 → 主 agent 跟踪各任务会话状态汇报进展**。

## 目标

1. 主 agent 会话（真实 dsh AgentLoop）通过工具操作需求/项目/任务域（CRUD + 状态流转），数据与现有 REST API 同域持久化
2. 每个任务一个 1:1 关联的真实 AgentLoop 子会话（`task-*`）：任务上下文注入、作用域工具、事件跟踪、重启可恢复
3. 状态同步（混合推进）：会话启动自动 `todo→doing`；子 agent 完成任务后 `report_task_status` 置 `review`；用户/主 agent 在看板或工具侧收尾 `done`
4. 主 agent 可监督子会话：查询状态与最近事件、追加指令、停止/重试

## 非目标（v1）

- 子会话审批桥接到主聊天 UI（v1 用 auto-allow / 配置可切 `never` 确定性拒绝）
- 多用户会话隔离（沿用现有平台会话语义）
- 真实 LLM 拆解端点（拆解由主 agent 在对话内原生完成，`tasks/decompose` mock 接口保持不动）
- 需求状态与任务状态自动级联（主 agent 可用工具手动推进）
- 任务↔会话 1:N 历史（重试覆盖重建会话）
- 任务详情页独立 SSE 会话视图（子会话为真实会话，可在聊天面板会话列表直接打开观看）
- 删除/迁移既有 mock 数据（`TASK-28xx` 序列不变）

## 数据模型改动

### octopus-tasks：TaskRecord 增加两个可空字段

```ts
interface TaskRecord {
  // ...现有字段不变
  agentSessionId?: string   // 1:1 关联的任务子会话 id；由服务端内部写入（REST 不可见）
  agentSummary?: string     // 子 agent 完成时自报的简短总结；REST 不可写（v1 只读展示）
}
```

- zod schema 增加两个 optional 字段；domain version 不变（storage-domain 按记录校验，optional 字段向后兼容）
- `TaskStore` 新增内部方法 `attachSession(id, sessionId)`（写链槽位内设置 `agentSessionId` 与 `updatedAt`）与 `setAgentSummary(id, summary)`；**不暴露到 REST PATCH**（客户端不可指定，同 `status` 创建时服务端保留的既有约定）

### 服务暴露（ctx.provide）

| 包 | 新增服务 | 说明 |
|---|---|---|
| `octopus-requirements` | `ctx.provide("requirementStore", store)` | 复用 apply 内已打开的 store |
| `octopus-tasks` | `ctx.provide("taskStore", store)` | 复用 apply 内已打开的 store |
| `octopus-projects` | `ctx.provide("projectStore", { list(), get(id) })` | 只读视图：id/name/description/status/workspacePath；内部复用 domain 表 |

> 依据：`ctx.storageDomain.open()` 为单开语义（同名域并发 open 抛 `already-open`）。workflow 不得自行打开三个域，必须消费各包已提供的服务；`inject` 数组保证加载顺序。

## 工具集

### 主作用域工具（`ctx.tools.register`，14 个）

所有工具参数用 schemastery（`@deepseek-ai/schemastery`）声明，错误统一返回 dsh 工具错误消息（含 `code`）。

| 工具 | 参数 | 说明 |
|---|---|---|
| `create_requirement` | `title`, `projectId`, `description?`, `priority?` | 经 `requirementStore.create`，`source: "chat"`（预留字段落地） |
| `list_requirements` | `projectId`, `status?`, `priority?` | |
| `get_requirement` | `id` | |
| `update_requirement` | `id`, `title?`/`description?`/`priority?`/`status?` | 沿用需求状态机（非法迁移报 `invalid-transition`） |
| `list_projects` | — | 供 agent 发现 projectId 与工作区 |
| `get_project` | `id` | 含 `workspacePath` |
| `list_tasks` | `projectId`, `requirementId?`, `status?` | |
| `get_task` | `id` | 含 `agentSessionId`/`agentSummary` |
| `create_tasks` | `requirementId`, `projectId`, `tasks: [{title, description?}]` | 批量保存（≤50，全有或全无）；拆解由主 agent 对话内原生完成 |
| `update_task` | `id`, `title?`/`description?`/`status?` | 沿用任务状态机 |
| `start_task_session` | `taskId` | 创建/恢复任务子会话（见生命周期）；重复调用返回既有会话 |
| `send_to_task_session` | `taskId`, `message` | 主 agent 追加指令/追问（followup） |
| `task_session_status` | `taskId` | 任务状态 + 会话 live/status + 最近事件摘要（环形缓冲尾 ~15 条）+ `agentSummary` |
| `stop_task_session` | `taskId` | 取消+释放子会话，任务 doing→todo（可重试） |

### 子会话作用域工具（经 `setup(agentCtx)` 注入，2 个）

| 工具 | 说明 |
|---|---|
| `get_task_context` | 读自己的任务记录 + 所属需求（title/description/priority），子 agent 开局自述 |
| `report_task_status` | `status: "review" \| "done"`，可选 `summary` 写入 `agentSummary`；`done` 前必须经 `review`（沿用状态机） |

`setup(agentCtx)` 同时执行 `agentCtx.tools.restrict({ deny: [14 个主工具名] })`：子会话不能嵌套建会话、不能改他人数据，只能干活 + 自报状态。`setup` 在 `session/created` 前生效（dsh 官方契约），且任务 id 写入会话 `meta.taskId`（持久化，供重启恢复重建作用域）。

## 子会话生命周期（TaskSessionManager）

```
start_task_session(taskId):
  task   = taskStore.get(taskId)                          // 不存在 → 工具错误 task-not-found
  project = projectStore.get(task.projectId)              // 不存在 → 工具错误 project-not-found
  cwd    = project.workspacePath ?? config.defaultCwd
  sessionId = "task-" + 8 位随机大写字母数字                // 与主会话 "oct-" 前缀区分
  handle = ctx.agents.create({
    sessionId,
    meta: { cwd, agentPreset: config.defaultAgentPreset ("standard"), taskId },
    setup: buildTaskSetup(taskId),                        // 2 个作用域工具 + restrict + 事件监听
  })
  handle.agent.ctx.on("approval/request", ...)            // 审批：默认 auto-allow（resolve "allowed-once"）；
                                                          // 配置 subSessionApproval: "never" 时确定性 resolve "rejected"
  await taskStore.attachSession(task.id, sessionId)       // 1:1 持久化关联
  await taskStore.update(task.id, { status: "doing" })    // 启动自动 todo→doing
  handle.agent.followup(任务执行消息)                       // 任务标题/描述 + 需求背景 + "完成后调用 report_task_status"
```

- **状态推进（混合）**：启动自动 `todo→doing`；子 agent 完成调 `report_task_status(review)`（`review` 后 agentSummary 落库）；`review→done` 由用户看板拖拽或主 agent `update_task` 完成。需求状态不自动联动（v1）。
- **事件跟踪**：`handle.agent.ctx` 监听 `session/event`、`agent/status`、`agent/error` → 纯函数投影（复用 octopus-agent `projectEvents` 投影模式的最小版）→ 每会话环形缓冲；`task_session_status` 返回尾部摘要。
- **监督**：`send_to_task_session` 对 live 会话 `followup`；会话 idle 时先 `ctx.agents.resume` 再 followup。
- **停止/重试**：`stop_task_session` → `agent.cancel({kind:"user"})` + dispose + `update task doing→todo`；再 `start_task_session` 重建会话（`attachSession` 覆盖）。
- **重启恢复**：dsh sessionPersistence 持久化会话；workflow 启动时扫描 `taskStore` 中有 `agentSessionId` 的任务，懒恢复：首次工具查询/启动时 `ctx.agents.resume({ resumeSessionId, setup })`（meta.taskId 重建作用域）。
- **审批隔离**：`approval/request` 为 scope-filtered waterfall，子会话监听器仅在其 agent.ctx 生效，不影响 octopus-agent 主会话桥与官方 Web UI。

## 错误处理

- 工具错误统一带 `code`（`not-found` / `invalid-input` / `invalid-transition` / `session-unavailable`），与各域既有错误码一致；主 agent 可读可修复（如 projectId 不存在 → 提示先 `list_projects`）。
- 子会话异常：`agent/error` 入环形缓冲，任务保持 doing；主 agent 经 `task_session_status` 发现并决定 stop/重试。
- 依赖服务未就绪（store 缺失）：工具执行返回 `session-unavailable` 错误；插件启动时域打开失败与 requirements 的 503 降级模式一致（v1 直接注册失败日志 + 工具报错）。
- `start_task_session` 并发防抖：同任务并发调用时返回已有会话，不重复创建。

## UI 改动（最小）

- `octopus-tasks` web 模块任务卡增加状态徽章：无会话 / 执行中 / 空闲 / 已停止（据 `agentSessionId` + 会话状态），以及 `agentSummary` 摘要气泡（如有）。
- 子会话是真实 dsh 会话，自动出现在聊天面板会话列表，可打开观看实时流（可监督）。
- 不做独立 SSE 视图、不做任务详情页。

## 包结构

```
packages/octopus-workflow/
├── package.json            # deps: dsh-tools/dsh-agent/dsh-user-approval/dsh-llm/schemastery；
│                           # peer: cordis, octopus-requirements, octopus-tasks, octopus-projects
├── cordis.patch.yml        # insert { id: octopus-workflow, name: octopus-workflow }
├── tsconfig.json / tsconfig.build.json / vitest.config.ts
└── src/
    ├── index.ts            # apply：inject [agents, tools, approval, requirementStore, taskStore, projectStore]；
    │                       # 注册主工具 + 懒恢复扫描 + 退场 dispose
    ├── types.ts            # 工具参数/结果类型、WorkflowConfig（defaultCwd/defaultAgentPreset/subSessionApproval）
    ├── tools.ts            # 主作用域 14 工具定义（defineTool）
    ├── sub-tools.ts        # buildTaskSetup(taskId)：2 个作用域工具 + restrict deny 名单
    ├── manager.ts          # TaskSessionManager：create/resume/stop/status/send/环形缓冲/dispose
    ├── sync.ts             # 事件→状态投影纯函数 + 状态同步规则
    └── *.test.ts
```

根 `package.json` dev/dev:noopen 脚本追加 `./packages/octopus-workflow`（挂载顺序：octopus-agent 之后）。

## 测试

- `sync.ts`：投影纯函数单测（事件→摘要、状态同步规则、环形缓冲裁剪）
- `manager.ts`：mock agents/approval/stores —— 创建/重复调用幂等/stop 回退/重试覆盖/懒恢复/审批策略
- `tools.ts`：12 工具参数校验与错误码、restrict deny 名单与 2 个子工具语义
- 既有包：三个 `ctx.provide` 冒烟测试（store 服务可注入、attachSession 不暴露 REST）
- 验收：`pnpm --filter octopus-workflow test/build`、根 `pnpm test`、`pnpm dev` 手工流程（聊天：创建需求 → 查询 → 拆解任务 → 建会话 → 查状态 → 停止/重试 → 看板终态）
