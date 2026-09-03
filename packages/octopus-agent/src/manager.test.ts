import { describe, expect, it, vi } from "vitest"
import { AgentManager, type AgentHandleLike, type AgentLike, type ApprovalOutcomeLike, type ManagerDeps, type PersistenceLike } from "./manager.js"

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
    options: { provider: "deepseek-official", model: "deepseek-v4-flash", maxTokens: 8192 },
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
    presetModels: new Map(),
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
    expect(meta.agentPreset).toBe("standard")
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

  it("create uses preset model override, explicit input wins", async () => {
    const { manager, agents } = makeManager({
      deps: {
        roles: [{ id: "octopus-developer", name: "开发工程师", description: "编码" }],
        presetModels: new Map([["octopus-developer", { provider: "p-a", model: "model-a" }]]),
        model: "global-default",
      },
    })
    await manager.create({ agentPreset: "octopus-developer" })
    expect(agents.create).toHaveBeenCalledWith(expect.objectContaining({
      agentOptions: { provider: "p-a", model: "model-a" },
    }))
    await manager.create({ agentPreset: "octopus-developer", model: "explicit" })
    expect(agents.create).toHaveBeenCalledWith(expect.objectContaining({
      agentOptions: { provider: "p-a", model: "explicit" },
    }))
    await manager.create({ agentPreset: "unknown-preset" })
    expect(agents.create).toHaveBeenCalledWith(expect.objectContaining({
      agentOptions: { model: "global-default" },
    }))
  })

  it("setPresetModel validates role, updates map and persists", async () => {
    const save = vi.fn()
    const map = new Map<string, { provider?: string; model?: string }>()
    const { manager } = makeManager({
      deps: {
        roles: [{ id: "octopus-pm", name: "项目负责人", description: "排期" }],
        presetModels: map,
        savePresetModels: save,
      },
    })
    expect(() => manager.setPresetModel("nope", { model: "x" })).toThrow("preset nope not found")
    manager.setPresetModel("octopus-pm", { model: "deepseek-v4-flash" })
    expect(map.get("octopus-pm")).toEqual({ provider: undefined, model: "deepseek-v4-flash" })
    expect(manager.presetModelOf("octopus-pm")).toEqual({ model: "deepseek-v4-flash" })
    expect(save).toHaveBeenCalledTimes(1)
    manager.setPresetModel("octopus-pm", { provider: undefined, model: undefined })
    expect(manager.presetModelOf("octopus-pm")).toBeUndefined()
    expect(map.has("octopus-pm")).toBe(false)
  })

  it("omits cwd when neither input nor default is provided", async () => {
    const { manager, agents } = makeManager()
    await manager.create({})
    const callOptions = agents.create.mock.calls[0][0]
    expect(callOptions.meta?.cwd).toBeUndefined()
    expect(callOptions.meta?.agentPreset).toBe("standard")
  })

  it("passes a persona setup when the preset is registered in the deps", async () => {
    const { manager, agents } = makeManager({
      deps: {
        personas: [{ presetId: "octopus-designer", sectionName: "deployment:persona", order: 0, text: "You are a designer." }],
        roles: [{ id: "octopus-developer", name: "开发工程师", description: "专注编码实现" }],
      },
    })
    await manager.create({ agentPreset: "octopus-designer" })
    const options = agents.create.mock.calls[0][0] as { setup?: (agentCtx: unknown) => Promise<void> }
    expect(typeof options.setup).toBe("function")
    const sectionSpy = vi.fn()
    const registerSpy = vi.fn()
    await options.setup!({
      get: (key: string) => (key === "systemPrompt" ? { section: sectionSpy } : key === "tools" ? { register: registerSpy } : undefined),
    })
    expect(sectionSpy).toHaveBeenCalledWith({
      name: "deployment:persona",
      order: 0,
      text: "You are a designer.",
    })
    expect(sectionSpy).toHaveBeenCalledWith(expect.objectContaining({
      name: "octopus:role-roster",
      text: expect.stringContaining("开发工程师"),
    }))
    expect(registerSpy).toHaveBeenCalledWith(expect.objectContaining({ name: "list_agent_roles" }))
  })

  it("sends a followup message with a stable message id", async () => {    const { manager, agents } = makeManager()
    const meta = await manager.create({})
    await manager.send(meta.id, "你好")
    const handle = (await agents.create.mock.results[0].value) as AgentHandleLike
    const sent = (handle.agent.followup as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as { id?: unknown; role: string; content: { type: string; text: string }[]; source: { kind: string } }
    expect(sent.role).toBe("user")
    expect(typeof sent.id).toBe("string")
    expect(sent.content[0]).toEqual({ type: "text", text: "你好" })
    expect(sent.source).toEqual({ kind: "user" })
    const failing = makeManager({
      persistLoad: vi.fn(async () => { throw new Error("not found") }),
    })
    await expect(failing.manager.send("oct-UNKNOWN", "x")).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" })
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

  it("send resumes a persisted session before following up", async () => {
    const { manager, agents } = makeManager({
      persistLoad: async () => ({ meta: { cwd: "/x", createdAt: 1 }, events: [] }),
    })
    await manager.send("oct-AAAAAAA1", "继续聊")
    expect(agents.resume).toHaveBeenCalledOnce()
    const handle = (await agents.resume.mock.results[0].value) as AgentHandleLike
    const sent = (handle.agent.followup as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as { id?: unknown }
    expect(typeof sent.id).toBe("string")
  })

  it("getContext resumes a persisted session and yields its prompt", async () => {    const { manager, agents } = makeManager({
      persistLoad: async () => ({ meta: { cwd: "/x", createdAt: 1 }, events: [] }),
      deps: {
        systemPrompt: {
          assemble: vi.fn(async () => ({ prompt: "assembled prompt", context: "runtime snapshot" })),
        },
      },
    })
    const ctx = await manager.getContext("oct-AAAAAAA1")
    expect(ctx.live).toBe(true)
    expect(ctx.provider).toBe("deepseek-official")
    expect(ctx.model).toBe("deepseek-v4-flash")
    expect(ctx.maxTokens).toBe(8192)
    expect(ctx.prompt).toBe("assembled prompt")
    expect(ctx.context).toBe("runtime snapshot")
    expect(agents.resume).toHaveBeenCalledOnce()
  })

  it("cancels the live agent with a user-kind cause", async () => {
    const { manager, agents } = makeManager()
    const meta = await manager.create({})
    const handle = (await agents.create.mock.results[0].value) as AgentHandleLike
    await manager.cancel(meta.id)
    expect(handle.agent.cancel).toHaveBeenCalledWith({ kind: "user" })
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
    const outcome = agent.emit("approval/request", { toolName: "fs_write", reason: "why" }) as Promise<ApprovalOutcomeLike>
    const idx = await manager.getIndex(meta.id)
    expect(idx.list()).toHaveLength(3)
    expect(idx.list()[0]).toMatchObject({ type: "user-message", text: "hi there" })
    expect(idx.list()[1]).toMatchObject({ type: "status", status: "running" })
    expect(idx.list()[2]).toMatchObject({ type: "approval", id: `${meta.id}:a0`, toolName: "fs_write" })
    expect(manager.getStatus(meta.id).pendingApprovalId).toBe(`${meta.id}:a0`)
    await manager.answerApproval(meta.id, `${meta.id}:a0`, "deny")
    await expect(outcome).resolves.toBe("rejected")
    expect(manager.getStatus(meta.id).pendingApprovalId).toBeUndefined()
  })

  it("resolves approval outcomes in the dsh vocabulary and cancels on dispose", async () => {
    const { manager, agents } = makeManager()
    const meta = await manager.create({})
    const handle = (await agents.create.mock.results[0].value) as AgentHandleLike
    const agent = handle.agent as TestAgent
    const allowed = agent.emit("approval/request", { toolName: "fs_write" }) as Promise<ApprovalOutcomeLike>
    await manager.answerApproval(meta.id, `${meta.id}:a0`, "allow")
    await expect(allowed).resolves.toBe("allowed-once")
    const rejected = agent.emit("approval/request", { toolName: "fs_write" }) as Promise<ApprovalOutcomeLike>
    await manager.answerApproval(meta.id, `${meta.id}:a1`, "deny")
    await expect(rejected).resolves.toBe("rejected")
    const cancelled = agent.emit("approval/request", { toolName: "fs_write" }) as Promise<ApprovalOutcomeLike>
    await manager.dispose(meta.id)
    await expect(cancelled).resolves.toBe("cancelled")
  })

  it("merges snapshots with live entries and evicts long-idle sessions", async () => {
    let now = 1000
    const snapshots = [
      { header: { id: "oct-AAAAAAA1", createdAt: "2026-01-01T00:00:00.000Z", meta: { cwd: "/old", agentPreset: "octopus-pm" } } },
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
    expect(first.find((meta) => meta.id === "oct-AAAAAAA1")).toMatchObject({ live: true, cwd: "/live" })
    now = 5000
    const second = await manager.list()
    expect(second.map((meta) => meta.id)).toEqual(["oct-SNAPSHOT", "oct-AAAAAAA1"])
    expect(second[1]).toMatchObject({
      live: false,
      cwd: "/old",
      createdAt: "2026-01-01T00:00:00.000Z",
      agentPreset: "octopus-pm",
    })
    const handle = (await agents.create.mock.results[0].value) as AgentHandleLike
    expect(handle.dispose).toHaveBeenCalled()
  })

  it("resume 从持久化历史恢复 agentPreset", async () => {
    const { manager, agents } = makeManager({
      persistLoad: vi.fn(async () => ({
        meta: { cwd: "/p", createdAt: 1, agentPreset: "octopus-designer" },
        events: [],
      })),
    })
    await manager.resume("oct-AAAAAAA1")
    const metas = await manager.list()
    expect(metas.find((m) => m.id === "oct-AAAAAAA1")).toMatchObject({ live: true, agentPreset: "octopus-designer" })
    expect(agents.resume).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: "oct-AAAAAAA1" }))
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

  it("begins a question event and resolves it through send with answerQuestionId without followup", async () => {
    const { manager, agents } = makeManager()
    const meta = await manager.create({})
    const handle = (await agents.create.mock.results[0].value) as AgentHandleLike
    const { qid, answerPromise } = manager.beginQuestion(meta.id, { callerItemId: "ask-1", question: "pick?", options: ["a", "b"] })
    expect(qid).toBe(`${meta.id}:q0`)
    const idx = await manager.getIndex(meta.id)
    expect(idx.list()).toHaveLength(1)
    expect(idx.list()[0]).toMatchObject({ type: "question", id: qid, question: "pick?", options: ["a", "b"] })
    await manager.send(meta.id, "answer", qid)
    await expect(answerPromise).resolves.toEqual({ answers: [{ id: "ask-1", selected: [], custom: "answer" }] })
    expect(handle.agent.followup).not.toHaveBeenCalled()
    expect(manager.getStatus(meta.id)).toMatchObject({ live: true })
  })

  it("falls back to the normal message path when answerQuestionId matches no pending question", async () => {
    const { manager, agents } = makeManager()
    const meta = await manager.create({})
    const handle = (await agents.create.mock.results[0].value) as AgentHandleLike
    await manager.send(meta.id, "hello", `${meta.id}:q99`)
    expect(handle.agent.followup).toHaveBeenCalledWith(expect.objectContaining({ source: { kind: "user" } }))
  })

  it("settles pending questions with empty answers on dispose", async () => {
    const { manager } = makeManager()
    const meta = await manager.create({})
    const { answerPromise } = manager.beginQuestion(meta.id, { callerItemId: "ask-1", question: "q?" })
    await manager.dispose(meta.id)
    await expect(answerPromise).resolves.toEqual({ answers: [] })
  })

  it("monitor halt surfaces a question banner with continue/stop options", async () => {
    const { manager } = makeManager()
    const meta = await manager.create({})
    manager.handleMonitorHalted({
      sessionId: meta.id,
      reason: "tokens",
      used: 120,
      limit: 100,
      message: "已消耗 120 tokens，达到限额 100",
    })
    const idx = await manager.getIndex(meta.id)
    expect(idx.list()[0]).toMatchObject({
      type: "question",
      question: "已消耗 120 tokens，达到限额 100，是否继续执行？",
      options: ["继续执行", "停止"],
    })
  })

  it("monitor halt ignores sessions it does not manage", async () => {
    const { manager } = makeManager()
    manager.handleMonitorHalted({
      sessionId: "oct-UNKNOWN",
      reason: "turns",
      used: 5,
      limit: 5,
      message: "已完成 5 轮，达到轮数限额 5",
    })
    expect((await manager.list()).length).toBeGreaterThanOrEqual(0)
  })

  it("answering continue resumes the monitored session without followup", async () => {
    const resume = vi.fn()
    const { manager, agents } = makeManager({ deps: { agentMonitor: { resume } } })
    const meta = await manager.create({})
    const handle = (await agents.create.mock.results[0].value) as AgentHandleLike
    manager.handleMonitorHalted({
      sessionId: meta.id,
      reason: "tokens",
      used: 100,
      limit: 100,
      message: "已消耗 100 tokens，达到限额 100",
    })
    const idx = await manager.getIndex(meta.id)
    const qevent = idx.list()[0]
    await manager.send(meta.id, "继续执行", (qevent as { id: string }).id)
    expect(resume).toHaveBeenCalledWith(meta.id)
    expect(handle.agent.followup).not.toHaveBeenCalled()
  })

  it("answering stop leaves the monitored session stopped", async () => {
    const resume = vi.fn()
    const { manager, agents } = makeManager({ deps: { agentMonitor: { resume } } })
    const meta = await manager.create({})
    const handle = (await agents.create.mock.results[0].value) as AgentHandleLike
    manager.handleMonitorHalted({
      sessionId: meta.id,
      reason: "tool-errors",
      used: 3,
      limit: 3,
      message: "工具调用已连续失败 3 次，达到限额 3",
    })
    const idx = await manager.getIndex(meta.id)
    const qevent = idx.list()[0]
    await manager.send(meta.id, "停止", (qevent as { id: string }).id)
    expect(resume).not.toHaveBeenCalled()
    expect(handle.agent.followup).not.toHaveBeenCalled()
  })
})
