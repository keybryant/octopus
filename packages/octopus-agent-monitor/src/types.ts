import type { MonitorHaltReason } from "./monitor.js"

/** 会话监控触发停机时通过 `agent-monitor/halted` 全局事件广播的负载 */
export interface AgentMonitorHaltEvent {
  sessionId: string
  reason: MonitorHaltReason
  used: number
  limit: number
  message: string
}

export interface AgentMonitorStatus {
  halted: boolean
  counters: { tokens: number; consecutiveToolErrors: number; turns: number }
}

/** octopus-agent-monitor 提供的服务：用户决策后续跑/查询/清理 */
export interface AgentMonitorService {
  /** 用户选择继续：重置计数并以 plugin 消息唤醒 agent 续跑；未 halt 或未知会话时为空操作 */
  resume(sessionId: string): void
  /** 查询会话监控状态；未知会话返回 undefined */
  status(sessionId: string): AgentMonitorStatus | undefined
  /** 主动清理会话监控状态（agent/disposed 时插件自动清理，手动销毁场景可调用） */
  drop(sessionId: string): void
}
