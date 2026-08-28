import { defineTool } from "@deepseek-ai/dsh-tools"
import { taskObjectSchema } from "./schemas.js"
import { MAIN_TOOL_NAMES, toolError } from "./tools.js"
import type { AgentCtxLike, RequirementStoreLike, TaskStoreLike } from "./types.js"
import { WorkflowError } from "./types.js"

export type { AgentCtxLike } from "./types.js"

export interface SubToolsDeps {
  taskStore: TaskStoreLike
  requirementStore: RequirementStoreLike
}

const text = (s: string) => [{ type: "text" as const, text: s }]

/**
 * 任务子会话作用域装配：注入 get_task_context / report_task_status 两个工具，
 * 并屏蔽全部主作用域工具（防嵌套建会话/改他人数据）。
 */
export function buildTaskSetup(deps: SubToolsDeps, taskId: string): (agentCtx: AgentCtxLike) => void {
  const { taskStore, requirementStore } = deps
  return (agentCtx: AgentCtxLike): void => {
    agentCtx.tools.register(defineTool({
      name: "get_task_context",
      description: "读取本任务及其所属需求（标题/描述/优先级）。开工前先调用。",
      parameters: {},
      output: {
        schema: {
          type: "object", additionalProperties: false,
          properties: {
            task: { ...taskObjectSchema, required: true },
            requirement: {
              oneOf: [
                {
                  type: "object", additionalProperties: false,
                  properties: {
                    id: { type: "string", required: true },
                    title: { type: "string", required: true },
                    description: { type: "string", required: true },
                    priority: { type: "string", required: true, enum: ["P0", "P1", "P2"] },
                  },
                },
                { type: "null" },
              ],
              required: true,
            },
          },
        },
        render: (_args, value) => text(`task ${value.task.id}: ${value.task.title}`),
      },
      async execute() {
        try {
          const task = taskStore.get(taskId)
          if (!task) throw new WorkflowError("task-not-found", `task ${taskId} not found`)
          const requirement = requirementStore.get(task.requirementId)
          return { task, requirement: requirement ?? null }
        } catch (error) {
          throw toolError(error)
        }
      },
    }))
    agentCtx.tools.register(defineTool({
      name: "report_task_status",
      description: "上报本任务进度。工作完成后调用 status=review 提交评审（可附简短总结）；review 被确认后再调用 status=done 收尾。",
      parameters: {
        status: {
          type: "string", required: true, enum: ["review", "done"],
          description: "review：完成并提交评审；done：终态（须先 review）。",
        },
        summary: { type: "string", description: "完成情况简述（写入任务记录 agentSummary）。" },
      },
      output: {
        schema: taskObjectSchema,
        render: (_args, value) => text(`task ${value.id} → ${value.status}`),
      },
      async execute(args) {
        try {
          const task = taskStore.get(taskId)
          if (!task) throw new WorkflowError("task-not-found", `task ${taskId} not found`)
          if (args.summary !== undefined) {
            await taskStore.setAgentSummary(taskId, args.summary.trim())
          }
          return await taskStore.update(taskId, { status: args.status })
        } catch (error) {
          throw toolError(error)
        }
      },
    }))
    agentCtx.tools.restrict({ deny: [...MAIN_TOOL_NAMES] })
  }
}
