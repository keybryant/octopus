# octopus-workflow

Agent 编排服务插件：主 agent 会话（工作台聊天）通过 14 个工具直接操作需求/项目/任务域，并为每个任务拉起独立 dsh 子会话执行。

## 能力

- **主会话工具**（14 个，注入 `ctx.tools`）：需求（`create_requirement` / `list_requirements` / `get_requirement` / `update_requirement`）、项目（`list_projects` / `get_project`）、任务（`list_tasks` / `get_task` / `create_tasks` / `update_task`）、会话编排（`start_task_session` / `send_to_task_session` / `task_session_status` / `stop_task_session`）
- **项目作用域**：主会话工具从调用会话的 cwd（=项目工作区）推导当前项目——PM agent 只能查看/操作当前项目的数据（跨项目访问返回 `project-scope` 错误），`list_projects` 仅返回当前项目
- **任务子会话**：`TaskSessionManager` 为任务创建/恢复真实 AgentLoop 子会话（工作目录=项目工作区），任务自动置「进行中」；子 agent 完成后经 `report_task_status` 提交评审
- **作用域工具**：子会话注入 `get_task_context` / `report_task_status`，并按 restrict mask 收敛可用工具集
- **事件跟踪**：会话/代理/审批事件投影到环形缓冲，`task_session_status` 返回最近 15 条摘要
- **审批策略**：`subSessionApproval` 默认 `"allow"`（自动放行，无头执行）；设 `"never"` 时需审批的工具调用被确定性拒绝（只读审计模式）

## 依赖服务

`ctx.get` 读取平台与三域 store 服务：`agents`（平台 AgentRegistry）、`tools`、`requirementStore`、`taskStore`、`projectStore`。store 服务由 `octopus-projects` / `octopus-requirements` / `octopus-tasks` 提供；缺失时工具仍注册，调用时抛错降级。

> **降级行为说明**：当任一依赖域（requirements/tasks/projects）存储打开失败时，对应 store 服务不提供，octopus-workflow 插件整体不加载（主 agent 将看不到本插件的 14 个工具）。这与 spec「工具执行返回 session-unavailable」的字面差异已记录，正常态不可达。

## 配置

```ts
export const Config = z.object({
  defaultCwd: z.string().required(false),                    // 子会话工作目录兜底
  defaultAgentPreset: z.string().default("standard"),        // 子 agent 预设
  subSessionApproval: z.union(["allow", "never"]).default("allow"),
  provider: z.string().required(false),                      // 子 agent 模型提供方
  model: z.string().required(false),                         // 子 agent 模型
})
```
