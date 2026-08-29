import { defineTool } from "@deepseek-ai/dsh-tools"
import {
  projectListSchema,
  projectObjectSchema,
  requirementListSchema,
  requirementObjectSchema,
  taskListSchema,
  taskObjectSchema,
} from "./schemas.js"
import type { ProjectStoreLike, RequirementStoreLike, TaskSessionLike, TaskStoreLike } from "./types.js"
import type { TaskPatch } from "./types.js"
import { WorkflowError } from "./types.js"
import type { ProjectView } from "octopus-projects"

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
] as const

/** 把带 code 的错误包装为模型可读的 `[code] message` 文本 */
export function toolError(error: unknown): never {
  const code = (error as { code?: string } | undefined)?.code
  const message = error instanceof Error ? error.message : String(error)
  throw new Error(code ? `[${code}] ${message}` : message)
}

export interface MainToolsDeps {
  requirements: RequirementStoreLike & {
    list?(filter?: (record: import("octopus-requirements").RequirementRecord) => boolean): import("octopus-requirements").RequirementRecord[]
    create?(input: { title: string; projectId: string; description?: string; priority?: "P0" | "P1" | "P2"; source: "chat" }): Promise<import("octopus-requirements").RequirementRecord>
    update?(id: string, patch: { title?: string; description?: string; priority?: "P0" | "P1" | "P2"; status?: string }): Promise<import("octopus-requirements").RequirementRecord>
  }
  tasks: TaskStoreLike & {
    list?(filter?: (record: import("octopus-tasks").TaskRecord) => boolean): import("octopus-tasks").TaskRecord[]
    createBatch?(input: { requirementId: string; projectId: string; tasks: { title: string; description?: string }[] }): Promise<import("octopus-tasks").TaskRecord[]>
  }
  projects: ProjectStoreLike & { list?(): ProjectView[] }
  sessions: TaskSessionLike
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

export function createMainTools(deps: MainToolsDeps) {
  const { requirements, tasks, projects, sessions } = deps
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
        render: (_args, value) => text(`created requirement ${value.id}: ${value.title}`),
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
      description: "查询当前项目的需求列表，可按状态/优先级过滤。",
      parameters: {
        status: { type: "string", enum: ["backlog", "planned", "in-progress", "review", "done"], description: "状态过滤。" },
        priority: { type: "string", enum: ["P0", "P1", "P2"], description: "优先级过滤。" },
      },
      output: {
        schema: requirementListSchema,
        render: (_args, value) => text(`found ${value.length} requirements`),
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
      description: "按 id 查询当前项目的单条需求。",
      parameters: { id: { type: "string", required: true, description: "需求 id，如 REQ-100。" } },
      output: {
        schema: requirementObjectSchema,
        render: (_args, value) => text(`requirement ${value.id}: ${value.title}`),
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
        render: (_args, value) => text(`updated requirement ${value.id}: ${value.status}`),
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
        render: (_args, value) => text(`current project: ${value[0]?.id}`),
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
        render: (_args, value) => text(`project ${value.id}: ${value.name}`),
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
      description: "查询当前项目的任务列表，可按需求/状态过滤。",
      parameters: {
        requirementId: { type: "string", description: "需求 id 过滤。" },
        status: { type: "string", enum: ["todo", "doing", "review", "done"], description: "状态过滤。" },
      },
      output: {
        schema: taskListSchema,
        render: (_args, value) => text(`found ${value.length} tasks`),
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
      description: "按 id 查询当前项目的单条任务（含 agentSessionId/agentSummary）。",
      parameters: { id: { type: "string", required: true, description: "任务 id，如 TASK-2800。" } },
      output: {
        schema: taskObjectSchema,
        render: (_args, value) => text(`task ${value.id}: ${value.title} [${value.status}]`),
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
        render: (_args, value) => text(`created ${value.length} tasks`),
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
        render: (_args, value) => text(`updated task ${value.id}: ${value.status}`),
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
        render: (_args, value) => text(`task session started: ${value.sessionId}`),
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
      description: "向当前项目的任务子会话追加指令/追问（不创建新会话；会话会立即响应）。",
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
      description: "查询当前项目任务的执行情况：任务状态、会话 live/status、最近事件摘要（最后 15 条）与 agentSummary。用于跟踪进度与汇报。",
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
            events: {
              type: "array", required: true,
              items: { type: "object", additionalProperties: false, properties: {
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
              } },
            },
          },
        },
        render: (_args, value) => text(`task ${value.task.id}: ${value.task.status}; session ${value.session.live ? value.session.status ?? "running" : "offline"}; ${value.events.length} recent events`),
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
        render: (_args, value) => text(`stopped task session for ${value.id}`),
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
  ]
}
