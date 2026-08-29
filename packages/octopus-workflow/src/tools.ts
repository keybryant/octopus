import { defineTool } from "@deepseek-ai/dsh-tools"
import {
  projectListSchema,
  projectObjectSchema,
  requirementListSchema,
  requirementObjectSchema,
  taskListSchema,
  taskObjectSchema,
} from "./schemas.js"
import type { ProjectStoreLike, RequirementStoreLike, TaskSessionEvent, TaskSessionLike, TaskStoreLike } from "./types.js"
import type { TaskPatch } from "./types.js"
import { WorkflowError } from "./types.js"
import type { ProjectView } from "octopus-projects"
import type { RequirementRecord } from "octopus-requirements"
import type { TaskRecord } from "octopus-tasks"

export const MAIN_TOOL_NAMES = [
  "create_requirement",
  "list_requirements",
  "get_requirement",
  "update_requirement",
  "list_projects",
  "get_project",
  "list_tasks",
  "get_task",
  "create_tasks",
  "update_task",
  "start_task_session",
  "send_to_task_session",
  "task_session_status",
  "stop_task_session",
  "ask_task_session",
  "task_session_log",
] as const

/** 把带 code 的错误包装为模型可读的 `[code] message` 文本 */
export function toolError(error: unknown): never {
  const code = (error as { code?: string } | undefined)?.code
  const message = error instanceof Error ? error.message : String(error)
  throw new Error(code ? `[${code}] ${message}` : message)
}

export interface MainToolsDeps {
  requirements: RequirementStoreLike & {
    list?(filter?: (record: RequirementRecord) => boolean): RequirementRecord[]
    create?(input: { title: string; projectId: string; description?: string; priority?: "P0" | "P1" | "P2"; source: "chat" }): Promise<RequirementRecord>
    update?(id: string, patch: { title?: string; description?: string; priority?: "P0" | "P1" | "P2"; status?: string }): Promise<RequirementRecord>
  }
  tasks: TaskStoreLike & {
    list?(filter?: (record: TaskRecord) => boolean): TaskRecord[]
    createBatch?(input: { requirementId: string; projectId: string; tasks: { title: string; description?: string }[] }): Promise<TaskRecord[]>
  }
  projects: ProjectStoreLike & { list?(): ProjectView[] }
  sessions: TaskSessionLike
  /** ask_task_session 默认等待上限（毫秒） */
  askTimeoutMs?: number
}

/**
 * 从调用会话推导「当前项目」：会话 cwd 即项目工作区（PM 会话由工作台按项目创建）。
 * 推导失败（无项目上下文 / 工作区不属于任何项目）抛 project-scope。
 */
function requireCurrentProject(exec: unknown, projects: MainToolsDeps["projects"]): ProjectView {
  const header = (exec as {
    agent?: { session?: { header?: { cwd?: unknown } } }
  } | undefined)?.agent?.session?.header
  const cwd = header?.cwd
  if (typeof cwd !== "string" || cwd.length === 0) {
    throw new WorkflowError("project-scope", "agent session has no project workspace; switch to a project in the workbench first")
  }
  const record = projects.list!().find((p) => p.workspacePath === cwd)
  if (!record) {
    throw new WorkflowError("project-scope", `no project owns workspace ${cwd}`)
  }
  return record
}

/** 资源项目归属校验：PM agent 只能操作当前项目的数据 */
function guardProject(recordProjectId: string, current: ProjectView): void {
  if (recordProjectId !== current.id) {
    throw new WorkflowError(
      "project-scope",
      `resource belongs to another project; this agent is scoped to project ${current.id} (${current.name})`,
    )
  }
}

// ── 模型可见的详细渲染（dsh 工具结果 = render 输出，必须携带完整数据）──

const clamp = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s)

const formatRequirement = (r: RequirementRecord): string =>
  `${r.id} | ${r.title} | ${r.status} | ${r.priority}${r.description ? ` | ${clamp(r.description, 120)}` : ""}`

const formatTask = (t: TaskRecord): string =>
  `${t.id} | ${t.title} | ${t.status}${t.agentSessionId ? ` | session=${t.agentSessionId}` : ""}${t.agentSummary ? ` | 总结=${clamp(t.agentSummary, 120)}` : ""}`

const formatProject = (p: ProjectView): string => `${p.id} | ${p.name} | ${p.status} | ${p.workspacePath}`

function formatEvent(e: TaskSessionEvent): string {
  switch (e.type) {
    case "status":
      return `[状态] ${e.status}`
    case "user-message":
      return `[用户] ${e.text}`
    case "assistant-text":
      return `[助手] ${e.text}`
    case "tool-call":
      return `[工具调用] ${e.name}(${e.summary})`
    case "tool-result":
      return `[工具结果] ${e.name} ${e.ok ? "成功" : "失败"}: ${e.preview}`
    case "turn":
      return `[回合${e.at === "start" ? "开始" : "结束"}${e.reason !== undefined ? ` ${e.reason}` : ""}]`
    case "error":
      return `[错误] ${e.message}`
  }
}

function formatEvents(events: TaskSessionEvent[], max = 30): string {
  const tail = events.slice(Math.max(0, events.length - max))
  const lines = tail.map(formatEvent)
  if (events.length > max) lines.unshift(`…（共 ${events.length} 条，显示最后 ${max} 条）`)
  return lines.join("\n")
}

function formatList<T>(items: T[], formatter: (item: T) => string, label: string, max = 30): string {
  const shown = items.slice(0, max)
  const lines = shown.map(formatter)
  if (items.length > max) lines.push(`…（共 ${items.length} 条，显示前 ${max} 条）`)
  return `${label}（${items.length} 条）：\n${lines.join("\n")}`
}

/** TaskSessionEvent 的 JSON-schema 输出描述（status / log / ask 共用） */
const eventItemSchema = {
  type: "object", additionalProperties: false,
  properties: {
    type: { type: "string", required: true },
    text: { type: "string" },
    name: { type: "string" },
    status: { type: "string" },
    message: { type: "string" },
    summary: { type: "string" },
    preview: { type: "string" },
    ok: { type: "boolean" },
    at: { type: "string" },
    reason: { type: "string" },
  },
} as const

export function createMainTools(deps: MainToolsDeps) {
  const { requirements, tasks, projects, sessions } = deps
  const askTimeoutMs = deps.askTimeoutMs ?? 180_000
  const text = (s: string) => [{ type: "text" as const, text: s }]
  const guardTask = (id: string, current: ProjectView): void => {
    const record = tasks.get(id)
    if (!record) throw new WorkflowError("not-found", `task ${id} not found`)
    guardProject(record.projectId, current)
  }
  const guardRequirement = (id: string, current: ProjectView): void => {
    const record = requirements.get(id)
    if (!record) throw new WorkflowError("not-found", `requirement ${id} not found`)
    guardProject(record.projectId, current)
  }

  return [
    defineTool({
      name: "create_requirement",
      description: "在当前项目创建一条新需求。返回创建后的需求记录（含 id，形如 REQ-100）。",
      parameters: {
        title: { type: "string", required: true, description: "需求标题。" },
        description: { type: "string", description: "需求描述。" },
        priority: { type: "string", enum: ["P0", "P1", "P2"], description: "优先级，缺省 P2。" },
      },
      output: {
        schema: requirementObjectSchema,
        render: (_args, value) => text(`created requirement ${formatRequirement(value)}`),
      },
      async execute(args, exec) {
        try {
          const current = requireCurrentProject(exec, projects)
          return await requirements.create!({
            title: args.title,
            projectId: current.id,
            description: args.description,
            priority: args.priority,
            source: "chat",
          })
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "list_requirements",
      description: "查询当前项目的需求列表（返回每条需求的 id/标题/状态/优先级/描述），可按状态/优先级过滤。",
      parameters: {
        status: { type: "string", enum: ["backlog", "planned", "in-progress", "review", "done"], description: "状态过滤。" },
        priority: { type: "string", enum: ["P0", "P1", "P2"], description: "优先级过滤。" },
      },
      output: {
        schema: requirementListSchema,
        render: (_args, value) => text(formatList(value, formatRequirement, "需求列表")),
      },
      async execute(args, exec) {
        try {
          const current = requireCurrentProject(exec, projects)
          return requirements.list!((r) =>
            r.projectId === current.id
            && (args.status === undefined || r.status === args.status)
            && (args.priority === undefined || r.priority === args.priority),
          )
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "get_requirement",
      description: "按 id 查询当前项目的单条需求（含完整描述）。",
      parameters: { id: { type: "string", required: true, description: "需求 id，如 REQ-100。" } },
      output: {
        schema: requirementObjectSchema,
        render: (_args, value) => text(`requirement ${formatRequirement(value)}`),
      },
      async execute(args, exec) {
        try {
          const current = requireCurrentProject(exec, projects)
          guardRequirement(args.id, current)
          return requirements.get(args.id)!
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "update_requirement",
      description: "更新当前项目的需求（标题/描述/优先级/状态）。状态仅允许单向推进：backlog → planned → in-progress → review → done。",
      parameters: {
        id: { type: "string", required: true, description: "需求 id。" },
        title: { type: "string", description: "新标题。" },
        description: { type: "string", description: "新描述。" },
        priority: { type: "string", enum: ["P0", "P1", "P2"], description: "优先级。" },
        status: { type: "string", enum: ["backlog", "planned", "in-progress", "review", "done"], description: "新状态。" },
      },
      output: {
        schema: requirementObjectSchema,
        render: (_args, value) => text(`updated requirement ${formatRequirement(value)}`),
      },
      async execute(args, exec) {
        try {
          const current = requireCurrentProject(exec, projects)
          guardRequirement(args.id, current)
          const patch: { title?: string; description?: string; priority?: "P0" | "P1" | "P2"; status?: string } = {}
          if (args.title !== undefined) patch.title = args.title
          if (args.description !== undefined) patch.description = args.description
          if (args.priority !== undefined) patch.priority = args.priority
          if (args.status !== undefined) patch.status = args.status
          return await requirements.update!(args.id, patch)
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "list_projects",
      description: "查看当前项目（本 agent 绑定到工作台当前选中的项目，看不到其他项目）。",
      parameters: {},
      output: {
        schema: projectListSchema,
        render: (_args, value) => text(`当前项目：\n${formatProject(value[0])}`),
      },
      async execute(_args, exec) {
        try {
          const current = requireCurrentProject(exec, projects)
          return [{
            id: current.id,
            name: current.name,
            description: current.description,
            status: current.status,
            workspacePath: current.workspacePath,
            workspaceId: current.workspaceId,
            createdAt: current.createdAt,
          }]
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "get_project",
      description: "按 id 查询项目（仅限当前项目，含工作区路径）。",
      parameters: { id: { type: "string", required: true, description: "项目 id。" } },
      output: {
        schema: projectObjectSchema,
        render: (_args, value) => text(`project ${formatProject(value)}`),
      },
      async execute(args, exec) {
        try {
          const current = requireCurrentProject(exec, projects)
          if (args.id !== current.id) {
            throw new WorkflowError("project-scope", `project ${args.id} is not the current project (${current.id})`)
          }
          return { id: current.id, name: current.name, description: current.description, status: current.status, workspacePath: current.workspacePath, workspaceId: current.workspaceId, createdAt: current.createdAt }
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "list_tasks",
      description: "查询当前项目的任务列表（返回每条任务的 id/标题/状态/所属需求/会话/总结），可按需求/状态过滤。",
      parameters: {
        requirementId: { type: "string", description: "需求 id 过滤。" },
        status: { type: "string", enum: ["todo", "doing", "review", "done"], description: "状态过滤。" },
      },
      output: {
        schema: taskListSchema,
        render: (_args, value) => text(formatList(value, formatTask, "任务列表")),
      },
      async execute(args, exec) {
        try {
          const current = requireCurrentProject(exec, projects)
          return tasks.list!((r) =>
            r.projectId === current.id
            && (args.requirementId === undefined || r.requirementId === args.requirementId)
            && (args.status === undefined || r.status === args.status),
          )
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "get_task",
      description: "按 id 查询当前项目的单条任务（含 agentSessionId/agentSummary 完整字段）。",
      parameters: { id: { type: "string", required: true, description: "任务 id，如 TASK-2800。" } },
      output: {
        schema: taskObjectSchema,
        render: (_args, value) => text(`task ${formatTask(value)}`),
      },
      async execute(args, exec) {
        try {
          const current = requireCurrentProject(exec, projects)
          guardTask(args.id, current)
          return tasks.get(args.id)!
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "create_tasks",
      description: "按需求拆解结果批量保存任务到当前项目（一次最多 50 条，全有或全无）。先 get_requirement 获取需求，再在对话内拆解为任务列表后调用本工具。",
      parameters: {
        requirementId: { type: "string", required: true, description: "所属需求 id。" },
        tasks: {
          type: "array", required: true, description: "拆解出的任务列表。",
          items: {
            type: "object", additionalProperties: false,
            properties: {
              title: { type: "string", required: true, description: "任务标题。" },
              description: { type: "string", description: "任务描述。" },
            },
          },
        },
      },
      output: {
        schema: taskListSchema,
        render: (_args, value) => text(formatList(value, formatTask, "已创建任务")),
      },
      async execute(args, exec) {
        try {
          const current = requireCurrentProject(exec, projects)
          guardRequirement(args.requirementId, current)
          return await tasks.createBatch!({
            requirementId: args.requirementId,
            projectId: current.id,
            tasks: args.tasks,
          })
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "update_task",
      description: "更新当前项目的任务（标题/描述/状态）。状态仅允许单向推进：todo → doing → review → done；review 由子 agent 或用户确认后置 done。",
      parameters: {
        id: { type: "string", required: true, description: "任务 id。" },
        title: { type: "string", description: "新标题。" },
        description: { type: "string", description: "新描述。" },
        status: { type: "string", enum: ["todo", "doing", "review", "done"], description: "新状态。" },
      },
      output: {
        schema: taskObjectSchema,
        render: (_args, value) => text(`updated task ${formatTask(value)}`),
      },
      async execute(args, exec) {
        try {
          const current = requireCurrentProject(exec, projects)
          guardTask(args.id, current)
          const patch: TaskPatch = {}
          if (args.title !== undefined) patch.title = args.title
          if (args.description !== undefined) patch.description = args.description
          if (args.status !== undefined) patch.status = args.status
          return await tasks.update(args.id, patch)
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "start_task_session",
      description: "为当前项目的任务创建/恢复独立 agent 子会话并启动执行（任务自动置 doing）。已有会话时返回既有会话。",
      parameters: { taskId: { type: "string", required: true, description: "任务 id。" } },
      output: {
        schema: {
          type: "object", additionalProperties: false,
          properties: {
            sessionId: { type: "string", required: true },
            task: { ...taskObjectSchema, required: true },
          },
        },
        render: (_args, value) => text(`task session started: ${value.sessionId}\n${formatTask(value.task)}`),
      },
      async execute(args, exec) {
        try {
          const current = requireCurrentProject(exec, projects)
          guardTask(args.taskId, current)
          return await sessions.start(args.taskId)
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "send_to_task_session",
      description: "向当前项目的任务子会话追加指令/追问（不等待回复；需要读取回复用 ask_task_session）。",
      parameters: {
        taskId: { type: "string", required: true, description: "任务 id。" },
        message: { type: "string", required: true, description: "要发送的消息。" },
      },
      output: {
        schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean", required: true } } },
        render: (_args, value) => text(value.ok ? "sent" : "failed"),
      },
      async execute(args, exec) {
        try {
          const current = requireCurrentProject(exec, projects)
          guardTask(args.taskId, current)
          await sessions.send(args.taskId, args.message)
          return { ok: true }
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "task_session_status",
      description: "查询当前项目任务的执行情况：任务状态、会话 live/status、最近事件摘要（含消息全文）与 agentSummary。用于跟踪进度与汇报。",
      parameters: { taskId: { type: "string", required: true, description: "任务 id。" } },
      output: {
        schema: {
          type: "object", additionalProperties: false,
          properties: {
            task: { ...taskObjectSchema, required: true },
            session: {
              type: "object", additionalProperties: false, required: true,
              properties: {
                sessionId: { oneOf: [{ type: "string" }, { type: "null" }] },
                live: { type: "boolean", required: true },
                status: { type: "string", enum: ["idle", "running"] },
              },
            },
            events: { type: "array", required: true, items: eventItemSchema },
          },
        },
        render: (_args, value) => text(
          `task ${formatTask(value.task)}\n`
          + `session: live=${value.session.live} status=${value.session.status ?? "-"} id=${value.session.sessionId ?? "-"}\n`
          + `recent events:\n${formatEvents(value.events as TaskSessionEvent[])}`,
        ),
      },
      async execute(args, exec) {
        try {
          const current = requireCurrentProject(exec, projects)
          guardTask(args.taskId, current)
          return await sessions.status(args.taskId)
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "stop_task_session",
      description: "停止当前项目任务的子会话：取消执行、解绑会话、任务回退到待处理（todo），之后可重新 start。",
      parameters: { taskId: { type: "string", required: true, description: "任务 id。" } },
      output: {
        schema: taskObjectSchema,
        render: (_args, value) => text(`stopped task session for ${formatTask(value)}`),
      },
      async execute(args, exec) {
        try {
          const current = requireCurrentProject(exec, projects)
          guardTask(args.taskId, current)
          return await sessions.stop(args.taskId)
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "ask_task_session",
      description: "向当前项目的任务子会话提问并等待其回复全文（阻塞直到该轮回复结束；子 agent 可能边调工具边作答）。用于与执行 agent 对话、追问细节、收集结果。",
      parameters: {
        taskId: { type: "string", required: true, description: "任务 id。" },
        message: { type: "string", required: true, description: "要问的问题/指令。" },
        timeoutMs: { type: "integer", description: `等待上限毫秒（缺省 ${askTimeoutMs}）。` },
      },
      output: {
        schema: {
          type: "object", additionalProperties: false,
          properties: {
            reply: { type: "string", required: true },
            events: { type: "array", required: true, items: eventItemSchema },
          },
        },
        render: (_args, value) => text(`子 agent 回复：\n${value.reply}${value.events.length > 0 ? `\n\n--- 该轮事件 ---\n${formatEvents(value.events as TaskSessionEvent[])}` : ""}`),
      },
      async execute(args, exec) {
        try {
          const current = requireCurrentProject(exec, projects)
          guardTask(args.taskId, current)
          return await sessions.ask(args.taskId, args.message, args.timeoutMs ?? askTimeoutMs)
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "task_session_log",
      description: "读取当前项目任务子会话的完整执行记录：用户/助手消息全文、工具调用与结果（分页：after 起始条数、limit 单页上限）。非 live 会话自动从持久化历史重建。",
      parameters: {
        taskId: { type: "string", required: true, description: "任务 id。" },
        after: { type: "integer", description: "起始条数（默认 0）。" },
        limit: { type: "integer", description: "单页条数（默认 100，最大 500）。" },
      },
      output: {
        schema: {
          type: "object", additionalProperties: false,
          properties: {
            total: { type: "integer", required: true },
            events: { type: "array", required: true, items: eventItemSchema },
          },
        },
        render: (_args, value) => text(
          `执行记录（共 ${value.total} 条，返回 ${value.events.length} 条）：\n${(value.events as TaskSessionEvent[]).map(formatEvent).join("\n")}`,
        ),
      },
      async execute(args, exec) {
        try {
          const current = requireCurrentProject(exec, projects)
          guardTask(args.taskId, current)
          return await sessions.transcript(args.taskId, { after: args.after, limit: args.limit })
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
  ]
}
