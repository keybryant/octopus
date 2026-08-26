import { describe, expect, it, vi } from "vitest"
import { createMockAgentClient } from "./agent-client"

describe("createMockAgentClient", () => {
  it("returns priority script for todo keywords", async () => {
    const client = createMockAgentClient(0)
    const reply = await client.reply("先列一下优先事项")
    const cards = reply.blocks.find((b) => b.kind === "cards")
    expect(cards && cards.kind === "cards").toBeTruthy()
    if (cards && cards.kind === "cards") {
      expect(cards.cards).toHaveLength(3)
      expect(cards.cards[0].badge?.label).toBe("逾期")
      expect(cards.cards[0].actionLabel).toBe("让 Agent 接手 →")
    }
  })

  it("returns delegation script with steps for takeover keywords", async () => {
    const client = createMockAgentClient(0)
    const reply = await client.reply("把 TASK-2850 交给 Agent 自动跑")
    const steps = reply.blocks.find((b) => b.kind === "steps")
    expect(steps && steps.kind === "steps").toBeTruthy()
    if (steps && steps.kind === "steps") {
      expect(steps.items.map((s) => s.state)).toEqual(["done", "active", "pending"])
    }
    expect(reply.artifacts?.some((a) => a.live)).toBe(true)
  })

  it("falls back to ack for unmatched input", async () => {
    const client = createMockAgentClient(0)
    const reply = await client.reply("随便说点什么")
    expect(reply.blocks[0].kind).toBe("paragraph")
  })

  it("resolves after at least delayMs", async () => {
    vi.useFakeTimers()
    const spy = vi.fn()
    const p = createMockAgentClient(500).reply("hi").then(spy)
    vi.advanceTimersByTime(499)
    await Promise.resolve()
    expect(spy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await p
    vi.useRealTimers()
  })
})
