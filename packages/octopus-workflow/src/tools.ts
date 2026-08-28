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

export function createMainTools(deps: MainToolsDeps) {
  const { requirements, tasks, projects, sessions } = deps
  const project = (id: string): void => {
    if (!projects.get(id)) throw new WorkflowError("project-not-found", `project ${id} not found`)
  }
  const text = (s: string) => [{ type: "text" as const, text: s }]

  return [
    defineTool({
      name: "create_requirement",
      description: "创建一条新需求。要求先通过 list_projects 确认 projectId。返回创建后的需求记录。",
      parameters: {
        title: { type: "string", required: true, description: "需求标题。" },
        projectId: { type: "string", required: true, description: "所属项目 id（list_projects 查询）。" },
        description: { type: "string", description: "需求描述。" },
        priority: { type: "string", enum: ["P0", "P1", "P2"], description: "优先级，缺省 P2。" },
      },
      output: {
        schema: requirementObjectSchema,
        render: (_args, value) => text(`created requirement ${value.id}: ${value.title}`),
      },
      async execute(args) {
        try {
          project(args.projectId)
          return await requirements.create!({
            title: args.title,
            projectId: args.projectId,
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
      description: "按项目查询需求列表，可按状态/优先级过滤。",
      parameters: {
        projectId: { type: "string", required: true, description: "项目 id。" },
        status: { type: "string", enum: ["backlog", "planned", "in-progress", "review", "done"], description: "状态过滤。" },
        priority: { type: "string", enum: ["P0", "P1", "P2"], description: "优先级过滤。" },
      },
      output: {
        schema: requirementListSchema,
        render: (_args, value) => text(`found ${value.length} requirements`),
      },
      async execute(args) {
        try {
          const items = requirements.list!((r) =>
            r.projectId === args.projectId
            && (args.status === undefined || r.status === args.status)
            && (args.priority === undefined || r.priority === args.priority),
          )
          return items
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "get_requirement",
      description: "按 id 查询单条需求。",
      parameters: { id: { type: "string", required: true, description: "需求 id，如 REQ-100。" } },
      output: {
        schema: requirementObjectSchema,
        render: (_args, value) => text(`requirement ${value.id}: ${value.title}`),
      },
      async execute(args) {
        try {
          const record = requirements.get(args.id)
          if (!record) throw new WorkflowError("not-found", `requirement ${args.id} not found`)
          return record
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "update_requirement",
      description: "更新需求（标题/描述/优先级/状态）。状态仅允许单向推进：backlog → planned → in-progress → review → done。",
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
      async execute(args) {
        try {
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
      description: "列出全部项目（含工作区路径），用于发现 projectId。",
      parameters: {},
      output: {
        schema: projectListSchema,
        render: (_args, value) => text(`found ${value.length} projects`),
      },
      async execute() {
        try {
          return projects.list!().map(({ id, name, description, status, workspacePath, workspaceId, createdAt }) =>
            ({ id, name, description, status, workspacePath, workspaceId, createdAt }))
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "get_project",
      description: "按 id 查询项目（含工作区路径）。",
      parameters: { id: { type: "string", required: true, description: "项目 id。" } },
      output: {
        schema: projectObjectSchema,
        render: (_args, value) => text(`project ${value.id}: ${value.name}`),
      },
      async execute(args) {
        try {
          const record = projects.get(args.id)
          if (!record) throw new WorkflowError("project-not-found", `project ${args.id} not found`)
          return { id: record.id, name: record.name, description: record.description, status: record.status, workspacePath: record.workspacePath, workspaceId: record.workspaceId, createdAt: record.createdAt }
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "list_tasks",
      description: "按项目查询任务列表，可按需求/状态过滤。",
      parameters: {
        projectId: { type: "string", required: true, description: "项目 id。" },
        requirementId: { type: "string", description: "需求 id 过滤。" },
        status: { type: "string", enum: ["todo", "doing", "review", "done"], description: "状态过滤。" },
      },
      output: {
        schema: taskListSchema,
        render: (_args, value) => text(`found ${value.length} tasks`),
      },
      async execute(args) {
        try {
          return tasks.list!((r) =>
            r.projectId === args.projectId
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
      description: "按 id 查询单条任务（含 agentSessionId/agentSummary）。",
      parameters: { id: { type: "string", required: true, description: "任务 id，如 TASK-2800。" } },
      output: {
        schema: taskObjectSchema,
        render: (_args, value) => text(`task ${value.id}: ${value.title} [${value.status}]`),
      },
      async execute(args) {
        try {
          const record = tasks.get(args.id)
          if (!record) throw new WorkflowError("not-found", `task ${args.id} not found`)
          return record
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "create_tasks",
      description: "按需求拆解结果批量保存任务（一次最多 50 条，全有或全无）。先 get_requirement 获取需求，再在对话内拆解为任务列表后调用本工具。",
      parameters: {
        requirementId: { type: "string", required: true, description: "所属需求 id。" },
        projectId: { type: "string", required: true, description: "项目 id（与需求一致）。" },
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
      async execute(args) {
        try {
          project(args.projectId)
          return await tasks.createBatch!({
            requirementId: args.requirementId,
            projectId: args.projectId,
            tasks: args.tasks,
          })
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "update_task",
      description: "更新任务（标题/描述/状态）。状态仅允许单向推进：todo → doing → review → done；review 由子 agent 或用户确认后置 done。",
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
      async execute(args) {
        try {
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
      description: "为任务创建/恢复独立 agent 子会话并启动执行（任务自动置 doing）。已有会话时返回既有会话。",
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
      async execute(args) {
        try {
          return await sessions.start(args.taskId)
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "send_to_task_session",
      description: "向任务子会话追加指令/追问（不创建新会话；会话会立即响应）。",
      parameters: {
        taskId: { type: "string", required: true, description: "任务 id。" },
        message: { type: "string", required: true, description: "要发送的消息。" },
      },
      output: {
        schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean", required: true } } },
        render: (_args, value) => text(value.ok ? "sent" : "failed"),
      },
      async execute(args) {
        try {
          await sessions.send(args.taskId, args.message)
          return { ok: true }
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "task_session_status",
      description: "查询任务执行情况：任务状态、会话 live/status、最近事件摘要（最后 15 条）与 agentSummary。用于跟踪进度与汇报。",
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
      async execute(args) {
        try {
          return await sessions.status(args.taskId)
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
    defineTool({
      name: "stop_task_session",
      description: "停止任务子会话：取消执行、解绑会话、任务回退到待处理（todo），之后可重新 start。",
      parameters: { taskId: { type: "string", required: true, description: "任务 id。" } },
      output: {
        schema: taskObjectSchema,
        render: (_args, value) => text(`stopped task session for ${value.id}`),
      },
      async execute(args) {
        try {
          return await sessions.stop(args.taskId)
        } catch (error) {
          throw toolError(error)
        }
      },
    }),
  ]
}
