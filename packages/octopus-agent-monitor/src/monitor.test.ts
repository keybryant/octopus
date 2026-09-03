import { describe, expect, it } from "vitest"
import { SessionMonitor, type SessionEventLike } from "./monitor.js"

const ev = (type: string, data: Record<string, unknown> = {}): SessionEventLike => ({ seq: 0, time: 1, type, data })

describe("SessionMonitor", () => {
  it("accumulates token usage from assistant/message usage", () => {
    const monitor = new SessionMonitor({ maxTokens: 1000 })
    monitor.observe(ev("assistant/message", { usage: { inputTokens: 100, outputTokens: 40 } }))
    monitor.observe(ev("assistant/message", { usage: { inputTokens: 10, outputTokens: 5 } }))
    expect(monitor.counters).toEqual({ tokens: 155, consecutiveToolErrors: 0, turns: 0 })
    expect(monitor.isHalted).toBe(false)
  })

  it("ignores malformed or missing usage", () => {
    const monitor = new SessionMonitor({ maxTokens: 100 })
    monitor.observe(ev("assistant/message", { usage: { inputTokens: -5, outputTokens: "x" } }))
    monitor.observe(ev("assistant/message", {}))
    expect(monitor.counters.tokens).toBe(0)
  })

  it("halts when cumulative tokens reach maxTokens and reports used/limit", () => {
    const monitor = new SessionMonitor({ maxTokens: 100 })
    expect(monitor.observe(ev("assistant/message", { usage: { inputTokens: 60, outputTokens: 40 } }))).toEqual({
      reason: "tokens",
      used: 100,
      limit: 100,
      message: "已消耗 100 tokens，达到限额 100",
    })
    expect(monitor.isHalted).toBe(true)
  })

  it("counts consecutive tool errors and resets on success", () => {
    const monitor = new SessionMonitor({ maxConsecutiveToolErrors: 3 })
    monitor.observe(ev("tool/result", { error: { message: "boom" } }))
    monitor.observe(ev("tool/result", { error: { message: "boom" } }))
    monitor.observe(ev("tool/result", {}))
    monitor.observe(ev("tool/result", { error: {} }))
    expect(monitor.counters.consecutiveToolErrors).toBe(1)
    monitor.observe(ev("tool/result", { error: {} }))
    expect(monitor.observe(ev("tool/result", { error: {} }))).toEqual({
      reason: "tool-errors",
      used: 3,
      limit: 3,
      message: "工具调用已连续失败 3 次，达到限额 3",
    })
  })

  it("halts when turns reach maxTurns", () => {
    const monitor = new SessionMonitor({ maxTurns: 2 })
    monitor.observe(ev("turn/start"))
    expect(monitor.observe(ev("turn/start"))).toEqual({
      reason: "turns",
      used: 2,
      limit: 2,
      message: "已完成 2 轮，达到轮数限额 2",
    })
  })

  it("ignores unrelated events", () => {
    const monitor = new SessionMonitor({ maxTokens: 1, maxConsecutiveToolErrors: 1, maxTurns: 1 })
    expect(monitor.observe(ev("user/message", { text: "hi" }))).toBeUndefined()
    expect(monitor.observe(ev("turn/end", { reason: { kind: "completed" } }))).toBeUndefined()
    expect(monitor.observe(ev("agent/status", {}))).toBeUndefined()
    expect(monitor.isHalted).toBe(false)
  })

  it("does not re-trigger after halt until reset", () => {
    const monitor = new SessionMonitor({ maxTokens: 100 })
    monitor.observe(ev("assistant/message", { usage: { inputTokens: 100, outputTokens: 0 } }))
    expect(monitor.isHalted).toBe(true)
    expect(monitor.observe(ev("assistant/message", { usage: { inputTokens: 999, outputTokens: 999 } }))).toBeUndefined()
    expect(monitor.counters.tokens).toBe(100)
  })

  it("reset clears counters and lifts the halt", () => {
    const monitor = new SessionMonitor({ maxTokens: 100 })
    monitor.observe(ev("assistant/message", { usage: { inputTokens: 100, outputTokens: 0 } }))
    expect(monitor.isHalted).toBe(true)
    monitor.reset()
    expect(monitor.isHalted).toBe(false)
    expect(monitor.counters).toEqual({ tokens: 0, consecutiveToolErrors: 0, turns: 0 })
    expect(monitor.observe(ev("assistant/message", { usage: { inputTokens: 50, outputTokens: 0 } }))).toBeUndefined()
  })

  it("replay stops at the first halt", () => {
    const monitor = new SessionMonitor({ maxTokens: 100 })
    const halt = monitor.replay([
      ev("assistant/message", { usage: { inputTokens: 60, outputTokens: 0 } }),
      ev("turn/start"),
      ev("assistant/message", { usage: { inputTokens: 60, outputTokens: 0 } }),
      ev("turn/start"),
    ])
    expect(halt?.reason).toBe("tokens")
    expect(halt?.used).toBe(120)
    expect(monitor.counters.turns).toBe(1)
    expect(monitor.isHalted).toBe(true)
  })

  it("replay without halt leaves counters rebuilt", () => {
    const monitor = new SessionMonitor({ maxTokens: 100 })
    expect(monitor.replay([ev("assistant/message", { usage: { inputTokens: 30, outputTokens: 0 } }), ev("turn/start")])).toBeUndefined()
    expect(monitor.counters).toEqual({ tokens: 30, consecutiveToolErrors: 0, turns: 1 })
  })

  it("disabled limits never halt", () => {
    const monitor = new SessionMonitor({})
    monitor.observe(ev("assistant/message", { usage: { inputTokens: 99999, outputTokens: 99999 } }))
    monitor.observe(ev("tool/result", { error: {} }))
    monitor.observe(ev("turn/start"))
    expect(monitor.isHalted).toBe(false)
  })
})
