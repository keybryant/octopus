import z from "@deepseek-ai/schemastery"
import type { Context } from "@deepseek-ai/cordis"
import { TASK_STATUS_CHANGED_EVENT, type TaskRecord } from "octopus-tasks"
import { MONITOR_HALT_EVENT, type AgentMonitorHaltEvent } from "octopus-agent-monitor"
import { TaskSessionManager, createTaskSessionId, type AgentsLike, type PersistenceLike } from "./manager.js"
import { createMainTools, type MainToolsDeps } from "./tools.js"
import { buildTaskSetup } from "./sub-tools.js"

export const name = "octopus-workflow"
export const inject = ["agents", "tools", "requirementStore", "taskStore", "projectStore"]

export const Config = z.object({
  defaultCwd: z.string().required(false),
  defaultAgentPreset: z.string().default("standard"),
  /** 子会话审批策略：allow=自动放行（默认，无头执行）；never=确定性拒绝（只读审计模式） */
  subSessionApproval: z.union(["allow", "never"]).default("allow"),
  /** ask_task_session 默认等待上限（毫秒） */
  askTimeoutMs: z.number().default(180_000),
  provider: z.string().required(false),
  model: z.string().required(false),
})

type WorkflowConfig = ReturnType<typeof Config>

interface ToolsLike {
  register(definition: unknown): () => void
}

interface DefaultModelLike {
  currentSelection?(): { provider?: string; model?: string } | undefined
}

/** 编排插件：主 agent 工具（需求/任务/项目/会话编排）+ 任务子会话管理 */
export async function apply(ctx: Context, config: Partial<WorkflowConfig> = {}) {
  // ctx.get 返回平台 AgentRegistry/真实 store；结构兼容断言到本地接口
  const agents = ctx.get("agents") as unknown as AgentsLike
  const tools = ctx.get("tools") as ToolsLike
  const requirementStore = ctx.get("requirementStore") as unknown as MainToolsDeps["requirements"]
  const taskStore = ctx.get("taskStore") as unknown as MainToolsDeps["tasks"]
  const projectStore = ctx.get("projectStore") as unknown as MainToolsDeps["projects"]
  const persistence = ctx.get("sessionPersistence") as PersistenceLike | undefined
  // 与 octopus-agent 一致：未显式配置时沿用平台默认模型（settings 的 agent-default-model）。
  // dsh 的 persona 模板引用 {{model}} 变量（取 agent.options.model），缺失会导致回合在组装阶段失败。
  const defaultModel = ctx.get("agentDefaultModel") as DefaultModelLike | undefined
  const selection = typeof defaultModel?.currentSelection === "function" ? defaultModel.currentSelection() : undefined
  // 按预设取模型覆盖（octopus-agent 提供；懒读取避免插件加载顺序耦合）
  const presetModelService = (): { get?(id: string): { provider?: string; model?: string } | undefined } => {
    return (ctx.get("agentPresetModels") ?? {}) as { get?(id: string): { provider?: string; model?: string } | undefined }
  }

  const manager = new TaskSessionManager({
    agents,
    taskStore,
    requirementStore,
    projectStore,
    sessionIdFactory: createTaskSessionId,
    defaultCwd: config.defaultCwd ?? null,
    defaultAgentPreset: config.defaultAgentPreset ?? "standard",
    provider: config.provider ?? selection?.provider,
    model: config.model ?? selection?.model,
    presetModels: (presetId) => presetModelService().get?.(presetId),
    approval: config.subSessionApproval ?? "allow",
    buildTaskSetup: (taskId) => buildTaskSetup({ taskStore, requirementStore }, taskId),
    ...(persistence !== undefined ? { persistence } : {}),
  })

  ctx.effect(() => {
    const disposers = createMainTools({
      requirements: requirementStore,
      tasks: taskStore,
      projects: projectStore,
      sessions: manager,
      askTimeoutMs: config.askTimeoutMs,
    }).map((definition) => tools.register(definition))
    // 事件驱动派发：任务变为执行中（doing）即为该任务创建新会话并启动对应智能体执行
    const offStatusChanged = ctx.on(TASK_STATUS_CHANGED_EVENT, (record: TaskRecord) => {
      if (record.status !== "doing") return
      void manager.start(record.id).catch((error) => {
        console.warn(`[octopus-workflow] auto-start failed for task ${record.id}:`, error)
      })
    })
    // 监控停机事件：任务子会话超限 → 回退 todo 等待用户重新派发
    const offMonitorHalted = ctx.on(MONITOR_HALT_EVENT, (payload: AgentMonitorHaltEvent) => {
      manager.handleMonitorHalted(payload)
    })
    return () => {
      offStatusChanged()
      offMonitorHalted()
      for (const dispose of disposers) dispose()
      void manager.withdraw()
    }
  })
}

export default { name, inject, Config, apply }
