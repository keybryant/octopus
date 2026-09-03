import { createUserMessage } from "@deepseek-ai/dsh-llm"
import z from "@deepseek-ai/schemastery"
import type { Context } from "@deepseek-ai/cordis"
import { SessionMonitor, type MonitorHalt, type MonitorLimits, type SessionEventLike } from "./monitor.js"
import type { AgentMonitorHaltEvent, AgentMonitorService, AgentMonitorStatus } from "./types.js"

export * from "./monitor.js"
export type { AgentMonitorHaltEvent, AgentMonitorService, AgentMonitorStatus } from "./types.js"

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** 会话日志监控服务（由 octopus-agent-monitor 提供；未挂载时缺失） */
    agentMonitor: AgentMonitorService
  }
  interface Events {
    /** agent 注册（dsh-agent 广播；本插件据此开始观察会话日志） */
    "agent/created"(payload: { agent: AgentLike }): void
    /** agent 销毁（dsh-agent 广播；本插件据此清理状态） */
    "agent/disposed"(payload: { agent: AgentLike }): void
    /** 会话触发监控限额停机（载荷见 AgentMonitorHaltEvent） */
    "agent-monitor/halted"(payload: AgentMonitorHaltEvent): void
  }
}

export const name = "octopus-agent-monitor"
/** 纯旁观插件：不注入任何服务，从根 ctx 订阅 agent 生命周期、从会话事件日志重建监控状态 */
export const inject = [] as const

export const Config = z.object({
  /** 会话累计 input+output tokens 上限；0 = 不监控 */
  maxTokens: z.number().default(0),
  /** 连续工具调用失败次数上限；0 = 不监控 */
  maxConsecutiveToolErrors: z.number().default(0),
  /** 轮数上限；0 = 不监控 */
  maxTurns: z.number().default(0),
})

const RESUME_TEXT = "请继续执行之前的任务。"
const PLUGIN_ID = "octopus-agent-monitor"
export const MONITOR_HALT_EVENT = "agent-monitor/halted"

/** 真实 dsh Agent 的最小结构面（agent/created payload、cancel/followup、session 日志） */
export interface AgentLike {
  id: string
  ctx: { on(event: string, listener: (...args: unknown[]) => unknown): unknown }
  session: { events: SessionEventLike[] }
  cancel(cause: { kind: string }, options?: { keepInbox?: boolean }): void
  followup(message: unknown): void
}

interface Entry {
  agent: AgentLike
  monitor: SessionMonitor
}

/** 日志驱动的 agent 监控插件：token / 连续工具错误 / 轮数限额，超限停机并等待用户决策 */
export async function apply(ctx: Context, config: Partial<MonitorLimits> = {}) {
  const states = new Map<string, Entry>()

  const haltSession = (agent: AgentLike, halt: MonitorHalt): void => {
    agent.cancel({ kind: "user" }, { keepInbox: true })
    const event: AgentMonitorHaltEvent = { sessionId: agent.id, ...halt }
    ctx.emit("agent-monitor/halted", event)
  }

  ctx.effect(() => {
    const offCreated = ctx.on("agent/created", (payload: { agent?: AgentLike }) => {
      const agent = payload?.agent
      if (!agent) return
      const entry: Entry = { agent, monitor: new SessionMonitor(config) }
      states.set(agent.id, entry)
      // 重建：先重放持久化会话日志（resume 后累计不丢），再订阅实时事件流增量累计
      const replayHalt = entry.monitor.replay(agent.session?.events ?? [])
      if (replayHalt) haltSession(agent, replayHalt)
      agent.ctx.on("session/event", (session: unknown, event: unknown) => {
        if ((session as { id?: string } | undefined)?.id !== agent.id) return
        if (states.get(agent.id) !== entry) return
        const halt = entry.monitor.observe(event as SessionEventLike)
        if (halt) haltSession(agent, halt)
      })
    })
    const offDisposed = ctx.on("agent/disposed", (payload: { agent?: AgentLike }) => {
      if (payload?.agent) states.delete(payload.agent.id)
    })

    const service: AgentMonitorService = {
      resume(sessionId: string): void {
        const entry = states.get(sessionId)
        if (!entry || !entry.monitor.isHalted) return
        entry.monitor.reset()
        entry.agent.followup(
          createUserMessage({
            content: [{ type: "text", text: RESUME_TEXT }],
            source: { kind: "plugin", plugin: PLUGIN_ID },
          }),
        )
      },
      status(sessionId: string): AgentMonitorStatus | undefined {
        const entry = states.get(sessionId)
        if (!entry) return undefined
        return { halted: entry.monitor.isHalted, counters: entry.monitor.counters }
      },
      drop(sessionId: string): void {
        states.delete(sessionId)
      },
    }
    ctx.provide("agentMonitor", service)

    return () => {
      offCreated()
      offDisposed()
      states.clear()
    }
  })
}

export default { name, inject, Config, apply }
