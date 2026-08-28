import { randomInt } from "node:crypto"
import { createUserMessage } from "@deepseek-ai/dsh-llm"
import type { TaskRecord } from "octopus-tasks"
import {
  appendEvent,
  createProjectState,
  projectEvents,
  tailEvents,
  type SessionEventLike,
} from "./sync.js"
import type {
  AgentCtxLike,
  ProjectStoreLike,
  RequirementStoreLike,
  TaskSessionEvent,
  TaskSessionStatus,
  TaskStoreLike,
} from "./types.js"
import { WorkflowError } from "./types.js"

const RANDOM_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function createTaskSessionId(): string {
  let suffix = ""
  for (let i = 0; i < 8; i += 1) suffix += RANDOM_CHARS[randomInt(RANDOM_CHARS.length)]
  return `task-${suffix}`
}

export type ApprovalOutcomeLike = "allowed-once" | "rejected"

export interface AgentLike {
  id: string
  status: "idle" | "running"
  ctx: { on(event: string, listener: (...args: unknown[]) => unknown): unknown }
  followup(message: unknown): void
  cancel(cause: { kind: "user" }): void
}

export interface AgentHandleLike {
  agent: AgentLike
  dispose(): Promise<void>
}

export interface AgentsLike {
  create(options: {
    sessionId: string
    meta?: { cwd?: string; agentPreset?: string; taskId?: string }
    agentOptions?: { provider?: string; model?: string }
    setup?: (agentCtx: AgentCtxLike) => void | Promise<void>
  }): Promise<AgentHandleLike>
  resume(options: {
    resumeSessionId: string
    agentOptions?: { provider?: string; model?: string }
    setup?: (agentCtx: AgentCtxLike) => void | Promise<void>
  }): Promise<AgentHandleLike>
}

export interface ManagerDeps {
  agents: AgentsLike
  taskStore: TaskStoreLike
  requirementStore: RequirementStoreLike
  projectStore: ProjectStoreLike
  sessionIdFactory: () => string
  defaultCwd: string | null
  defaultAgentPreset: string
  provider?: string
  model?: string
  approval: "allow" | "never"
  buildTaskSetup: (taskId: string) => (agentCtx: AgentCtxLike) => void
}

interface Entry {
  taskId: string
  sessionId: string
  handle: AgentHandleLike
  events: TaskSessionEvent[]
  lastActivityMs: number
  /** agent/status 事件驱动的实时状态（初始化自 handle.agent.status，随后由监听器更新） */
  status: "idle" | "running"
}

interface StartInflight {
  token: object
  promise: Promise<{ sessionId: string; task: TaskRecord }>
}

interface ResumeInflight {
  token: object
  promise: Promise<Entry>
}

/** 任务子会话编排：创建/恢复/停止/追问/状态 + 事件环形缓冲 + 审批策略 */
export class TaskSessionManager {
  private entries = new Map<string, Entry>()
  /** start 进行中去抖：并发 start 复用同一 Promise，防双 create/双 resume */
  private starting = new Map<string, StartInflight>()
  /** send 懒恢复进行中去抖：并发 send 复用同一 Promise，防双 resume */
  private resuming = new Map<string, ResumeInflight>()
  private currentNow = (): number => Date.now()

  constructor(private deps: ManagerDeps) {}

  setNowSource(fn: () => number): void {
    this.currentNow = fn
  }

  private agentOptions(): { provider?: string; model?: string } {
    const options: { provider?: string; model?: string } = {}
    if (this.deps.provider !== undefined) options.provider = this.deps.provider
    if (this.deps.model !== undefined) options.model = this.deps.model
    return options
  }

  async start(taskId: string): Promise<{ sessionId: string; task: TaskRecord }> {
    const existing = this.entries.get(taskId)
    if (existing) {
      const task = this.deps.taskStore.get(taskId)
      if (!task) throw new WorkflowError("task-not-found", `task ${taskId} not found`)
      return { sessionId: existing.sessionId, task }
    }
    const inflight = this.starting.get(taskId)
    if (inflight) return inflight.promise
    const token = {}
    const promise = this.doStart(taskId, token)
    this.starting.set(taskId, { token, promise })
    try {
      return await promise
    } finally {
      if (this.starting.get(taskId)?.token === token) this.starting.delete(taskId)
    }
  }

  private async doStart(taskId: string, token: object): Promise<{ sessionId: string; task: TaskRecord }> {
    const task = this.deps.taskStore.get(taskId)
    if (!task) throw new WorkflowError("task-not-found", `task ${taskId} not found`)

    const fresh = task.agentSessionId === undefined
    const sessionId = task.agentSessionId ?? this.deps.sessionIdFactory()
    let handle: AgentHandleLike
    if (fresh) {
      const cwd = this.resolveCwd(task)
      try {
        handle = await this.deps.agents.create({
          sessionId,
          meta: { cwd: cwd ?? undefined, agentPreset: this.deps.defaultAgentPreset, taskId },
          agentOptions: this.agentOptions(),
          setup: this.deps.buildTaskSetup(taskId),
        })
      } catch (error) {
        throw new WorkflowError(
          "session-unavailable",
          `task session create failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    } else {
      handle = await this.resumeOrThrow(taskId, sessionId)
    }
    if (this.starting.get(taskId)?.token !== token) {
      // stop 已接管（或已被新 start 取代）：不写 entry，释放刚取得的 handle
      await handle.dispose().catch(() => {})
      return { sessionId, task: this.deps.taskStore.get(taskId) ?? task }
    }
    try {
      if (fresh) await this.deps.taskStore.attachSession(taskId, sessionId)
      if (task.status === "todo") {
        await this.deps.taskStore.update(taskId, { status: "doing" })
      }
    } catch (error) {
      await handle.dispose().catch(() => {})
      throw error
    }
    if (this.starting.get(taskId)?.token !== token) {
      await handle.dispose().catch(() => {})
      return { sessionId, task: this.deps.taskStore.get(taskId) ?? task }
    }
    const entry: Entry = { taskId, sessionId, handle, events: [], lastActivityMs: this.currentNow(), status: handle.agent.status }
    this.entries.set(taskId, entry)
    this.listenLive(taskId, entry, handle)
    if (fresh) this.kick(taskId, handle)
    const updated = this.deps.taskStore.get(taskId) ?? task
    return { sessionId, task: updated }
  }

  async stop(taskId: string): Promise<TaskRecord> {
    const task = this.deps.taskStore.get(taskId)
    if (!task) throw new WorkflowError("task-not-found", `task ${taskId} not found`)
    // 同步清掉 in-flight 去抖条目，使进行中的 start/send 感知到被接管而不再写 entry
    this.starting.delete(taskId)
    this.resuming.delete(taskId)
    const entry = this.entries.get(taskId)
    if (entry) {
      entry.handle.agent.cancel({ kind: "user" })
      await entry.handle.dispose().catch(() => {})
      this.entries.delete(taskId)
    }
    await this.deps.taskStore.attachSession(taskId, null)
    return this.deps.taskStore.reopen(taskId)
  }

  async send(taskId: string, message: string): Promise<void> {
    const task = this.deps.taskStore.get(taskId)
    if (!task) throw new WorkflowError("task-not-found", `task ${taskId} not found`)
    if (!task.agentSessionId) {
      throw new WorkflowError("session-unavailable", `task ${taskId} has no agent session`)
    }
    const entry = this.entries.get(taskId) ?? await this.loadResumed(taskId, task.agentSessionId)
    entry.handle.agent.followup(createUserMessage({ content: [{ type: "text", text: message }], source: { kind: "user" } }))
    entry.lastActivityMs = this.currentNow()
  }

  async status(taskId: string): Promise<TaskSessionStatus> {
    const task = this.deps.taskStore.get(taskId)
    if (!task) throw new WorkflowError("task-not-found", `task ${taskId} not found`)
    const entry = this.entries.get(taskId)
    return {
      task,
      session: {
        sessionId: task.agentSessionId ?? null,
        live: Boolean(entry?.handle),
        status: entry?.status,
      },
      events: entry ? tailEvents(entry.events) : [],
    }
  }

  async withdraw(): Promise<void> {
    for (const entry of [...this.entries.values()]) {
      await entry.handle.dispose().catch(() => {})
    }
    this.entries.clear()
    this.starting.clear()
    this.resuming.clear()
  }

  private async resumeOrThrow(taskId: string, sessionId: string): Promise<AgentHandleLike> {
    try {
      return await this.deps.agents.resume({
        resumeSessionId: sessionId,
        agentOptions: this.agentOptions(),
        // 恢复时重建作用域（get_task_context/report_task_status + restrict），与 spec「重启懒恢复重建作用域」一致
        setup: this.deps.buildTaskSetup(taskId),
      })
    } catch (error) {
      throw new WorkflowError(
        "session-unavailable",
        `task session resume failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private async loadResumed(taskId: string, sessionId: string): Promise<Entry> {
    const inflight = this.resuming.get(taskId)
    if (inflight) return inflight.promise
    const token = {}
    const promise = this.doLoadResumed(taskId, sessionId, token)
    this.resuming.set(taskId, { token, promise })
    try {
      return await promise
    } finally {
      if (this.resuming.get(taskId)?.token === token) this.resuming.delete(taskId)
    }
  }

  private async doLoadResumed(taskId: string, sessionId: string, token: object): Promise<Entry> {
    const handle = await this.resumeOrThrow(taskId, sessionId)
    if (this.resuming.get(taskId)?.token !== token) {
      // stop 已接管：不写 entry，释放 handle，并让发起方以 session-unavailable 感知
      await handle.dispose().catch(() => {})
      throw new WorkflowError("session-unavailable", `task ${taskId} session resume superseded by stop`)
    }
    const entry: Entry = { taskId, sessionId, handle, events: [], lastActivityMs: this.currentNow(), status: handle.agent.status }
    this.entries.set(taskId, entry)
    this.listenLive(taskId, entry, handle)
    return entry
  }

  private resolveCwd(task: TaskRecord): string | null {
    const project = this.deps.projectStore.get(task.projectId)
    return project?.workspacePath ?? this.deps.defaultCwd
  }

  private kick(taskId: string, handle: AgentHandleLike): void {
    const task = this.deps.taskStore.get(taskId)
    const requirement = task ? this.deps.requirementStore.get(task.requirementId) : undefined
    const project = task ? this.deps.projectStore.get(task.projectId) : undefined
    const lines: string[] = ["你是任务执行 agent。请完成以下任务："]
    if (task) lines.push(`任务：${task.title}`)
    if (task?.description) lines.push(`任务描述：${task.description}`)
    if (requirement) {
      lines.push(`所属需求：${requirement.title}（优先级 ${requirement.priority}）`)
      if (requirement.description) lines.push(`需求描述：${requirement.description}`)
    }
    lines.push(`工作目录：${project?.workspacePath ?? this.deps.defaultCwd ?? process.cwd()}`)
    lines.push("完成工作后，调用 report_task_status 工具提交评审（status: review），可附简短总结。")
    handle.agent.followup(createUserMessage({ content: [{ type: "text", text: lines.join("\n") }], source: { kind: "user" } }))
  }

  private listenLive(taskId: string, entry: Entry, handle: AgentHandleLike): void {
    const { agent } = handle
    const st = createProjectState()
    const push = (event: TaskSessionEvent): void => {
      entry.events = appendEvent(entry.events, event)
      entry.lastActivityMs = this.currentNow()
    }
    agent.ctx.on("session/event", (session, event) => {
      if ((session as { id?: string } | undefined)?.id !== entry.sessionId) return
      for (const captured of projectEvents(st, event as SessionEventLike)) push(captured)
    })
    agent.ctx.on("agent/status", (payload) => {
      const { status } = payload as { status: "idle" | "running" }
      entry.status = status
      push({ type: "status", status })
    })
    agent.ctx.on("agent/error", (payload) => {
      const error = (payload as { error?: unknown } | undefined)?.error
      push({ type: "error", message: error instanceof Error ? error.message : String(error ?? "agent error") })
    })
    agent.ctx.on("approval/request", () => {
      return Promise.resolve<ApprovalOutcomeLike>(this.deps.approval === "allow" ? "allowed-once" : "rejected")
    })
  }
}
