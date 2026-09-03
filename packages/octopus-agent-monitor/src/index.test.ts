import { describe, expect, it, vi } from "vitest"
import { apply, type AgentLike } from "./index.js"
import type { SessionEventLike } from "./monitor.js"

type AgentTest = Omit<AgentLike, "followup" | "cancel" | "ctx"> & {
  ctx: { on: ReturnType<typeof vi.fn> }
  followup: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  emitSession(event: SessionEventLike): void
}

function fakeAgent(id: string, log: SessionEventLike[] = []): AgentTest {
  const listeners: Record<string, (...args: unknown[]) => unknown> = {}
  const agent: AgentTest = {
    id,
    ctx: {
      on: vi.fn((event: string, listener: (...args: unknown[]) => unknown) => {
        listeners[event] = listener
        return vi.fn()
      }),
    },
    session: { events: log },
    cancel: vi.fn(),
    followup: vi.fn(),
    emitSession(event: SessionEventLike): void {
      listeners["session/event"]?.({ id }, event)
    },
  }
  return agent
}

interface TestCtx {
  on(event: string, listener: (...args: unknown[]) => unknown): unknown
  emit: ReturnType<typeof vi.fn>
  provide: ReturnType<typeof vi.fn>
  effect: ReturnType<typeof vi.fn>
  agents: Map<string, AgentTest>
  emits: unknown[]
  service: { resume(id: string): void; status(id: string): unknown; drop(id: string): void }
  emitAgent(event: string, payload: { agent?: AgentTest }): void
  start(agent: AgentTest): Promise<void>
  dispose(agent: AgentTest): Promise<void>
}

function makeCtx(): TestCtx {
  const listeners: Record<string, (...args: unknown[]) => unknown> = {}
  const ctx = {
    on: vi.fn((event: string, listener: (...args: unknown[]) => unknown) => {
      listeners[event] = listener
      return vi.fn()
    }),
    emit: vi.fn((event: string, payload: unknown) => {
      ctx.emits.push(payload)
      listeners[event]?.(payload)
    }),
    provide: vi.fn(),
    effect: vi.fn((fn: () => unknown) => fn()),
    agents: new Map<string, AgentTest>(),
    emits: [] as unknown[],
    get service(): TestCtx["service"] {
      return ctx.provide.mock.calls[0]?.[1]
    },
  }
  const emitAgent = (event: string, payload: { agent?: AgentTest }): void => {
    listeners[event]?.(payload)
  }
  const start = async (agent: AgentTest): Promise<void> => {
    ctx.agents.set(agent.id, agent)
    emitAgent("agent/created", { agent })
  }
  const dispose = async (agent: AgentTest): Promise<void> => {
    ctx.agents.delete(agent.id)
    emitAgent("agent/disposed", { agent })
  }
  return Object.assign(ctx, { emitAgent, start, dispose })
}

function makeApply(config: Record<string, number>): TestCtx {
  const ctx = makeCtx()
  void apply(ctx as never, config)
  return ctx
}

const usageEvent = (input: number, output = 0): SessionEventLike => ({
  seq: 1,
  time: 1,
  type: "assistant/message",
  data: { usage: { inputTokens: input, outputTokens: output } },
})

describe("octopus-agent-monitor plugin", () => {
  it("emits halt and cancels the agent when tokens exceed maxTokens", async () => {
    const ctx = makeApply({ maxTokens: 100 })
    const agent = fakeAgent("oct-AAAA1111")
    await ctx.start(agent)
    agent.emitSession(usageEvent(60))
    agent.emitSession(usageEvent(50))
    expect(agent.cancel).toHaveBeenCalledWith({ kind: "user" }, { keepInbox: true })
    expect(ctx.emits).toEqual([
      expect.objectContaining({ sessionId: "oct-AAAA1111", reason: "tokens", used: 110, limit: 100 }),
    ])
  })

  it("does not halt before the threshold and keeps accumulating", async () => {
    const ctx = makeApply({ maxTokens: 100 })
    const agent = fakeAgent("oct-BBBB2222")
    await ctx.start(agent)
    agent.emitSession(usageEvent(40))
    agent.emitSession(usageEvent(40))
    expect(agent.cancel).not.toHaveBeenCalled()
    expect(ctx.emits).toEqual([])
  })

  it("replays the persisted session log on creation and halts immediately when over limit", async () => {
    const ctx = makeApply({ maxTokens: 100 })
    const agent = fakeAgent("oct-CCCC3333", [usageEvent(60), usageEvent(60)])
    await ctx.start(agent)
    expect(agent.cancel).toHaveBeenCalledTimes(1)
    expect(ctx.emits).toEqual([
      expect.objectContaining({ sessionId: "oct-CCCC3333", reason: "tokens", used: 120, limit: 100 }),
    ])
  })

  it("halts on consecutive tool errors and turns", async () => {
    const ctx = makeApply({ maxConsecutiveToolErrors: 2, maxTurns: 1 })
    const agent = fakeAgent("oct-DDDD4444")
    await ctx.start(agent)
    agent.emitSession({ seq: 1, time: 1, type: "tool/result", data: { error: { message: "x" } } })
    agent.emitSession({ seq: 2, time: 2, type: "tool/result", data: { error: { message: "x" } } })
    expect(ctx.emits[0]).toMatchObject({ sessionId: "oct-DDDD4444", reason: "tool-errors", used: 2, limit: 2 })
    agent.emitSession({ seq: 3, time: 3, type: "turn/start", data: {} })
    expect(ctx.emits).toHaveLength(1)
  })

  it("does not re-emit halt for a halted session", async () => {
    const ctx = makeApply({ maxTokens: 100 })
    const agent = fakeAgent("oct-EEEE5555")
    await ctx.start(agent)
    agent.emitSession(usageEvent(100))
    agent.emitSession(usageEvent(500))
    expect(ctx.emits).toHaveLength(1)
    expect(agent.cancel).toHaveBeenCalledTimes(1)
  })

  it("resume resets counters and wakes the agent with a plugin message", async () => {
    const ctx = makeApply({ maxTokens: 100 })
    const agent = fakeAgent("oct-FFFF6666")
    await ctx.start(agent)
    agent.emitSession(usageEvent(100))
    expect(ctx.service.status("oct-FFFF6666")).toEqual({
      halted: true,
      counters: { tokens: 100, consecutiveToolErrors: 0, turns: 0 },
    })
    ctx.service.resume("oct-FFFF6666")
    expect(ctx.service.status("oct-FFFF6666")).toMatchObject({ halted: false, counters: { tokens: 0 } })
    expect(agent.followup).toHaveBeenCalledTimes(1)
    const message = agent.followup.mock.calls[0][0] as { source?: { kind?: string } }
    expect(message.source?.kind).toBe("plugin")
    agent.emitSession(usageEvent(50))
    expect(ctx.emits).toHaveLength(1)
  })

  it("resume is a no-op for unknown or non-halted sessions", async () => {
    const ctx = makeApply({ maxTokens: 100 })
    const agent = fakeAgent("oct-GGGG7777")
    await ctx.start(agent)
    ctx.service.resume("oct-unknown")
    expect(agent.followup).not.toHaveBeenCalled()
    ctx.service.resume("oct-GGGG7777")
    expect(agent.followup).not.toHaveBeenCalled()
  })

  it("drop and dispose clear the state", async () => {
    const ctx = makeApply({ maxTokens: 100 })
    const agent = fakeAgent("oct-HHHH8888")
    await ctx.start(agent)
    expect(ctx.service.status("oct-HHHH8888")).toBeDefined()
    await ctx.dispose(agent)
    expect(ctx.service.status("oct-HHHH8888")).toBeUndefined()
    const agent2 = fakeAgent("oct-IIII9999")
    await ctx.start(agent2)
    ctx.service.drop("oct-IIII9999")
    expect(ctx.service.status("oct-IIII9999")).toBeUndefined()
  })

  it("disposed session events no longer trigger halts", async () => {
    const ctx = makeApply({ maxTokens: 100 })
    const agent = fakeAgent("oct-JJJJAAAA")
    await ctx.start(agent)
    await ctx.dispose(agent)
    agent.emitSession(usageEvent(200))
    expect(ctx.emits).toEqual([])
  })
})
