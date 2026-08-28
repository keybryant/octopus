import z from "@deepseek-ai/schemastery"
import type { Context } from "@deepseek-ai/cordis"
import { TaskSessionManager, createTaskSessionId, type AgentsLike } from "./manager.js"
import { createMainTools, type MainToolsDeps } from "./tools.js"
import { buildTaskSetup } from "./sub-tools.js"

export const name = "octopus-workflow"
export const inject = ["agents", "tools", "requirementStore", "taskStore", "projectStore"]

export const Config = z.object({
  defaultCwd: z.string().required(false),
  defaultAgentPreset: z.string().default("standard"),
  /** 子会话审批策略：allow=自动放行（默认，无头执行）；never=确定性拒绝（只读审计模式） */
  subSessionApproval: z.union(["allow", "never"]).default("allow"),
  provider: z.string().required(false),
  model: z.string().required(false),
})

type WorkflowConfig = ReturnType<typeof Config>

interface ToolsLike {
  register(definition: unknown): () => void
}

/** 编排插件：主 agent 工具（需求/任务/项目/会话编排）+ 任务子会话管理 */
export async function apply(ctx: Context, config: Partial<WorkflowConfig> = {}) {
  // ctx.get 返回平台 AgentRegistry/真实 store；结构兼容断言到本地接口
  const agents = ctx.get("agents") as unknown as AgentsLike
  const tools = ctx.get("tools") as ToolsLike
  const requirementStore = ctx.get("requirementStore") as unknown as MainToolsDeps["requirements"]
  const taskStore = ctx.get("taskStore") as unknown as MainToolsDeps["tasks"]
  const projectStore = ctx.get("projectStore") as unknown as MainToolsDeps["projects"]

  const manager = new TaskSessionManager({
    agents,
    taskStore,
    requirementStore,
    projectStore,
    sessionIdFactory: createTaskSessionId,
    defaultCwd: config.defaultCwd ?? null,
    defaultAgentPreset: config.defaultAgentPreset ?? "standard",
    provider: config.provider,
    model: config.model,
    approval: config.subSessionApproval ?? "allow",
    buildTaskSetup: (taskId) => buildTaskSetup({ taskStore, requirementStore }, taskId),
  })

  ctx.effect(() => {
    const disposers = createMainTools({
      requirements: requirementStore,
      tasks: taskStore,
      projects: projectStore,
      sessions: manager,
    }).map((definition) => tools.register(definition))
    return () => {
      for (const dispose of disposers) dispose()
      void manager.withdraw()
    }
  })
}

export default { name, inject, Config, apply }
