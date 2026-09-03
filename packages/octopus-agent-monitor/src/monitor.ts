/** 会话事件日志条目（dsh `session/event` 的最小结构面；与 octopus-agent project.ts 的 SessionEventLike 一致） */
export interface SessionEventLike {
  seq: number
  time: number
  type: string
  data: Record<string, unknown>
}

export interface MonitorLimits {
  /** 会话累计 input+output tokens 上限；0 = 不监控 */
  maxTokens?: number
  /** 连续工具调用失败次数上限；0 = 不监控 */
  maxConsecutiveToolErrors?: number
  /** 轮数上限；0 = 不监控 */
  maxTurns?: number
}

export type MonitorHaltReason = "tokens" | "tool-errors" | "turns"

export interface MonitorHalt {
  reason: MonitorHaltReason
  used: number
  limit: number
  /** 面向用户的触发说明（不含提问后缀，由集成方拼接） */
  message: string
}

const pickNonNegative = (value: unknown): number => {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0
  return n > 0 ? n : 0
}

function usageOf(data: Record<string, unknown>): { input: number; output: number } {
  const usage = data.usage as { inputTokens?: unknown; outputTokens?: unknown } | undefined
  if (typeof usage !== "object" || usage === null) return { input: 0, output: 0 }
  return { input: pickNonNegative(usage.inputTokens), output: pickNonNegative(usage.outputTokens) }
}

/**
 * 单个会话的日志驱动监控核心：从会话事件日志重建/累加计数器，超限产出 halt。
 * 纯状态机，不依赖任何框架；halted 后不再重复触发，直到 reset()。
 */
export class SessionMonitor {
  private tokens = 0
  private consecutiveToolErrors = 0
  private turns = 0
  private haltedReason: MonitorHaltReason | undefined

  constructor(private limits: MonitorLimits) {}

  get isHalted(): boolean {
    return this.haltedReason !== undefined
  }

  get counters(): { tokens: number; consecutiveToolErrors: number; turns: number } {
    return { tokens: this.tokens, consecutiveToolErrors: this.consecutiveToolErrors, turns: this.turns }
  }

  /** 观察一条日志事件，更新计数器；触发限额时返回 halt（此后该会话不再重复触发，直到 reset） */
  observe(event: SessionEventLike): MonitorHalt | undefined {
    if (this.haltedReason !== undefined) return undefined
    switch (event.type) {
      case "assistant/message": {
        const { input, output } = usageOf(event.data)
        if (input > 0 || output > 0) this.tokens += input + output
        break
      }
      case "tool/result": {
        this.consecutiveToolErrors = event.data.error !== undefined ? this.consecutiveToolErrors + 1 : 0
        break
      }
      case "turn/start": {
        this.turns += 1
        break
      }
      default:
        return undefined
    }
    return this.checkLimits()
  }

  /** 重放一段既有日志（resume 重建用）；任何一步触发 halt 即停（调用方决定后续处理） */
  replay(events: SessionEventLike[]): MonitorHalt | undefined {
    for (const event of events) {
      const halt = this.observe(event)
      if (halt !== undefined) return halt
    }
    return undefined
  }

  /** 重置计数并解除 halted（用户选择继续时由调用方调用） */
  reset(): void {
    this.tokens = 0
    this.consecutiveToolErrors = 0
    this.turns = 0
    this.haltedReason = undefined
  }

  private checkLimits(): MonitorHalt | undefined {
    const { maxTokens, maxConsecutiveToolErrors, maxTurns } = this.limits
    if (maxTokens && this.tokens >= maxTokens) {
      return this.halt("tokens", this.tokens, maxTokens, `已消耗 ${this.tokens} tokens，达到限额 ${maxTokens}`)
    }
    if (maxConsecutiveToolErrors && this.consecutiveToolErrors >= maxConsecutiveToolErrors) {
      return this.halt(
        "tool-errors",
        this.consecutiveToolErrors,
        maxConsecutiveToolErrors,
        `工具调用已连续失败 ${this.consecutiveToolErrors} 次，达到限额 ${maxConsecutiveToolErrors}`,
      )
    }
    if (maxTurns && this.turns >= maxTurns) {
      return this.halt("turns", this.turns, maxTurns, `已完成 ${this.turns} 轮，达到轮数限额 ${maxTurns}`)
    }
    return undefined
  }

  private halt(reason: MonitorHaltReason, used: number, limit: number, message: string): MonitorHalt {
    this.haltedReason = reason
    return { reason, used, limit, message }
  }
}
