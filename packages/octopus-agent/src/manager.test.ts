import { describe, expect, it, vi } from "vitest"
import { AgentManager, type AgentHandleLike, type AgentLike, type ManagerDeps, type PersistenceLike } from "./manager.js"

type TestAgent = AgentLike & { emit(event: string, ...args: unknown[]): unknown }

function fakeAgent(id: string, events: { status: "idle" | "running" }): TestAgent {
  const listeners: Record<string, (...args: unknown[]) => void> = {}
  const agent: AgentLike = {
    id,
    get status() { return events.status },
    ctx: {
      on(event: string, listener: (...args: unknown[]) => void): number {
        listeners[event] = listener
        return 0
      },
    },
    followup: vi.fn(),
    cancel: vi.fn(),
  }
  return Object.assign(agent, {
    emit(event: string, ...args: unknown[]): unknown {
      return listeners[event]?.(...args)
    },
  })
}

function makeManager(opts: {
  persistLoad?: PersistenceLike["load"]
  listSnapshots?: PersistenceLike["listSnapshots"]
  sessionIdFactory?: () => string
  deps?: Partial<Omit<ManagerDeps, "agents" | "persistence" | "sessionIdFactory">>
} = {}) {
  const agents = {
    create: vi.fn(async (options: {
      sessionId: string
      meta?: { cwd?: string; agentPreset?: string }
      agentOptions?: { provider?: string; model?: string }
    }): Promise<AgentHandleLike> => {
      return { agent: fakeAgent(options.sessionId, { status: "idle" }), dispose: vi.fn(async () => {}) }
    }),
    resume: vi.fn(async (options: { resumeSessionId: string }): Promise<AgentHandleLike> => {
      return { agent: fakeAgent(options.resumeSessionId, { status: "idle" }), dispose: vi.fn(async () => {}) }
    }),
  }
  const persistence: PersistenceLike = {
    load: opts.persistLoad ?? vi.fn(async () => ({ meta: { cwd: "/p", createdAt: 1 }, events: [] })),
    listSnapshots: opts.listSnapshots ?? vi.fn(async () => []),
  }
  let seq = 0
  const manager = new AgentManager({
    agents,
    persistence,
    sessionIdFactory: opts.sessionIdFactory ?? (() => `oct-${String(++seq).padStart(8, "A")}`),
    defaultCwd: null,
    defaultAgentPreset: "standard",
    provider: undefined,
    model: undefined,
    idleTtlMs: 0,
    ...opts.deps,
  })
  return { manager, agents, persistence }
}

describe("AgentManager", () => {
  it("creates a session with cwd preset and agentOptions", async () => {
    const { manager, agents } = makeManager()
    const meta = await manager.create({ cwd: "/project/open", agentPreset: "standard", provider: "deepseek-official", model: "deepseek-v4-flash" })
    expect(meta.id).toMatch(/^oct-/)
    expect(meta.cwd).toBe("/project/open")
    expect(meta.live).toBe(true)
    expect(agents.create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: meta.id,
      meta: expect.objectContaining({ cwd: "/project/open", agentPreset: "standard" }),
      agentOptions: { provider: "deepseek-official", model: "deepseek-v4-flash" },
    }))
  })

  it("applies defaults and filters undefined provider or model", async () => {
    const { manager, agents } = makeManager({ deps: { defaultCwd: "/home" } })
    await manager.create({})
    expect(agents.create).toHaveBeenCalledWith(expect.objectContaining({
      meta: { cwd: "/home", agentPreset: "standard" },
      agentOptions: {},
    }))
  })

  it("omits cwd when neither input nor default is provided", async () => {
    const { manager, agents } = makeManager()
    await manager.create({})
    const callOptions = agents.create.mock.calls[0][0]
    expect(callOptions.meta?.cwd).toBeUndefined()
    expect(callOptions.meta?.agentPreset).toBe("standard")
  })

  it("sends a followup message through the live agent", async () => {
    const { manager, agents } = makeManager()
    const meta = await manager.create({})
    await manager.send(meta.id, "你好")
    const handle = (await agents.create.mock.results[0].value) as AgentHandleLike
    expect(handle.agent.followup).toHaveBeenCalledWith({
      role: "user",
      content: [{ type: "text", text: "你好" }],
      source: { kind: "user" },
    })
    await expect(manager.send("oct-UNKNOWN", "x")).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" })
  })

  it("throws SESSION_EXISTS on duplicate id and SESSION_NOT_FOUND on unknown", async () => {
    const { manager, agents } = makeManager({ sessionIdFactory: () => "oct-FIXED0001" })
    await manager.create({})
    await expect(manager.create({})).rejects.toMatchObject({ code: "SESSION_EXISTS" })
    expect(agents.create).toHaveBeenCalledTimes(1)
    await expect(manager.getIndex("oct-UNKNOWN")).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" })
  })

  it("loads history from persistence and resumes on getIndex with allowResume", async () => {
    const { manager, agents } = makeManager({
      persistLoad: async () => ({
        meta: { cwd: "/x", createdAt: 1 },
        events: [
          { seq: 0, time: 1, type: "user/message", data: { text: "hi" } },
          { seq: 1, time: 2, type: "assistant/message", data: { message: { content: [{ type: "text", text: "yo" }] } } },
        ],
      }),
    })
    const idx = await manager.getIndex("oct-AAAAAAA1", { allowResume: true })
    const evs = idx.list()
    expect(evs).toHaveLength(2)
    expect(evs[0]).toMatchObject({ idx: 0, type: "user-message", text: "hi" })
    expect(evs[1]).toMatchObject({ idx: 1, type: "assistant-text", text: "yo" })
    expect(agents.resume).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: "oct-AAAAAAA1" }))
    expect(manager.getStatus("oct-AAAAAAA1")).toMatchObject({ live: true, status: "idle" })
  })

  it("answers pending approvals and errors on unknown approval id", async () => {
    const { manager } = makeManager()
    const meta = await manager.create({})
    ;(manager as unknown as { setPendingApprovalForTest(id: string, approvalId: string): void }).setPendingApprovalForTest(meta.id, `${meta.id}:a1`)
    expect(manager.getStatus(meta.id).pendingApprovalId).toBe(`${meta.id}:a1`)
    await expect(manager.answerApproval(meta.id, `${meta.id}:a1`, "allow")).resolves.toBeUndefined()
    await expect(manager.answerApproval(meta.id, `${meta.id}:a2`, "allow")).rejects.toMatchObject({ code: "APPROVAL_NOT_FOUND" })
  })

  it("projects live session events, status and approvals into the index", async () => {
    const { manager, agents } = makeManager()
    const meta = await manager.create({})
    const handle = (await agents.create.mock.results[0].value) as AgentHandleLike
    const agent = handle.agent as TestAgent
    agent.emit("session/event", { id: meta.id }, { seq: 0, time: 1, type: "user/message", data: { text: "hi there" } })
    agent.emit("agent/status", { status: "running" })
    const outcome = agent.emit("approval/request", { toolName: "fs_write", reason: "why" }) as Promise<"allow" | "deny" | "cancelled">
    const idx = await manager.getIndex(meta.id)
    expect(idx.list()).toHaveLength(3)
    expect(idx.list()[0]).toMatchObject({ type: "user-message", text: "hi there" })
    expect(idx.list()[1]).toMatchObject({ type: "status", status: "running" })
    expect(idx.list()[2]).toMatchObject({ type: "approval", id: `${meta.id}:a0`, toolName: "fs_write" })
    expect(manager.getStatus(meta.id).pendingApprovalId).toBe(`${meta.id}:a0`)
    await manager.answerApproval(meta.id, `${meta.id}:a0`, "deny")
    await expect(outcome).resolves.toBe("deny")
    expect(manager.getStatus(meta.id).pendingApprovalId).toBeUndefined()
  })

  it("merges snapshots with live entries and evicts long-idle sessions", async () => {
    let now = 1000
    const snapshots = [
      { header: { id: "oct-AAAAAAA1", createdAt: "2026-01-01T00:00:00.000Z", meta: { cwd: "/old" } } },
      { header: { id: "oct-SNAPSHOT", createdAt: "2026-01-02T00:00:00.000Z" } },
    ]
    const { manager, agents } = makeManager({
      deps: { idleTtlMs: 100 },
      listSnapshots: async () => snapshots,
    })
    manager.setNowSource(() => now)
    await manager.create({ cwd: "/live" })
    const first = await manager.list()
    expect(first.map((meta) => meta.id)).toEqual(["oct-AAAAAAA1", "oct-SNAPSHOT"])
    expect(first.find((meta) => meta.id === "oct-SNAPSHOT")).toMatchObject({ live: false, cwd: null })
    now = 5000
    const second = await manager.list()
    expect(second.map((meta) => meta.id)).toEqual(["oct-SNAPSHOT", "oct-AAAAAAA1"])
    expect(second[1]).toMatchObject({ live: false, cwd: "/old", createdAt: "2026-01-01T00:00:00.000Z" })
    const handle = (await agents.create.mock.results[0].value) as AgentHandleLike
    expect(handle.dispose).toHaveBeenCalled()
  })

  it("maps persistence and resume failures to manager errors", async () => {
    const { manager: loadFails } = makeManager({
      persistLoad: async () => { throw new Error("gone") },
    })
    await expect(loadFails.getIndex("oct-AAAAAAA1", { allowResume: true })).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" })
    const { manager: resumeFails, agents } = makeManager()
    agents.resume.mockRejectedValue(new Error("loop down"))
    await expect(resumeFails.resume("oct-AAAAAAA1")).rejects.toMatchObject({ code: "AGENT_LOOP_UNAVAILABLE" })
  })
})
