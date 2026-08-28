import { describe, expect, it, vi } from "vitest"
import { TaskSessionManager, createTaskSessionId, type AgentHandleLike, type AgentLike, type AgentsLike, type ManagerDeps } from "./manager.js"
import type { RequirementRecord } from "octopus-requirements"
import type { TaskRecord } from "octopus-tasks"
import type { ProjectView } from "octopus-projects"

function fakeAgent(id: string, status: "idle" | "running" = "idle"): AgentLike & { emit(event: string, ...args: unknown[]): unknown } {
  const listeners: Record<string, (listenerArgs: unknown[]) => unknown> = {}
  const agent: AgentLike = {
    id,
    get status() { return status },
    ctx: {
      on(event: string, listener: (...args: unknown[]) => unknown): number {
        listeners[event] = listener
        return 0
      },
    },
    followup: vi.fn(),
    cancel: vi.fn(),
  }
  return Object.assign(agent, {
    emit(event: string, ...args: unknown[]): unknown {
      const listener = listeners[event]
      if (!listener) return undefined
      return (listener as (...a: unknown[]) => unknown)(...args)
    },
  })
}

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "TASK-2800", title: "实现导出", description: "支持 CSV",
    requirementId: "REQ-100", projectId: "prjA", status: "todo",
    createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z",
    ...overrides,
  }
}

const makeRequirement = (): RequirementRecord => ({
  id: "REQ-100", title: "导出报表", description: "分页", priority: "P1",
  status: "planned", projectId: "prjA", source: "chat",
  createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z",
})

const makeProject = (): ProjectView => ({
  id: "prjA", name: "Alpha", description: "", status: "active",
  workspacePath: "C:/projects/alpha", workspaceId: "ws-1", createdAt: "2026-08-26T00:00:00.000Z",
})

function makeHarness(opts: { approval?: "allow" | "never"; createGate?: () => Promise<void> } = {}) {
  const tasks = new Map<string, TaskRecord>()
  const taskStore = {
    get: (id: string) => tasks.get(id),
    update: async (id: string, patch: Partial<TaskRecord>) => {
      const current = tasks.get(id)
      if (!current) throw new Error(`task ${id} not found`)
      const next: TaskRecord = { ...current, ...patch, updatedAt: new Date().toISOString() }
      tasks.set(id, next)
      return next
    },
    attachSession: vi.fn(async (id: string, sessionId: string | null) => {
      const current = tasks.get(id)
      if (!current) throw new Error(`task ${id} not found`)
      const next: TaskRecord = { ...current, agentSessionId: sessionId ?? undefined, updatedAt: new Date().toISOString() }
      tasks.set(id, next)
      return next
    }),
    setAgentSummary: async (id: string, summary: string) => {
      const current = tasks.get(id)
      if (!current) throw new Error(`task ${id} not found`)
      const next: TaskRecord = { ...current, agentSummary: summary, updatedAt: new Date().toISOString() }
      tasks.set(id, next)
      return next
    },
    reopen: async (id: string) => {
      const current = tasks.get(id)
      if (!current) throw new Error(`task ${id} not found`)
      const next: TaskRecord = { ...current, status: "todo", updatedAt: new Date().toISOString() }
      tasks.set(id, next)
      return next
    },
  }
  const requirementStore = { get: (id: string) => (id === "REQ-100" ? makeRequirement() : undefined) }
  const projectStore = { get: (id: string) => (id === "prjA" ? makeProject() : undefined) }
  const agents = {
    create: vi.fn(async (options: { sessionId: string }): Promise<AgentHandleLike> => {
      if (opts.createGate) await opts.createGate()
      return { agent: fakeAgent(options.sessionId), dispose: vi.fn(async () => {}) }
    }),
    resume: vi.fn(async (options: { resumeSessionId: string }): Promise<AgentHandleLike> => {
      return { agent: fakeAgent(options.resumeSessionId), dispose: vi.fn(async () => {}) }
    }),
  }
  let seq = 0
  const manager = new TaskSessionManager({
    agents,
    taskStore,
    requirementStore,
    projectStore,
    sessionIdFactory: () => `task-${String(++seq).padStart(8, "A")}`,
    defaultCwd: null,
    defaultAgentPreset: "standard",
    provider: undefined,
    model: undefined,
    approval: opts.approval ?? "allow",
    buildTaskSetup: () => () => {},
  })
  return { manager, agents, taskStore, tasks }
}

describe("TaskSessionManager", () => {
  it("start 创建会话：meta 携带 cwd/taskId、attachSession 关联、todo→doing、kick 消息含任务标题", async () => {
    const h = makeHarness()
    h.tasks.set("TASK-2800", makeTask())
    const result = await h.manager.start("TASK-2800")
    expect(result.sessionId).toMatch(/^task-/)
    expect(h.agents.create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: result.sessionId,
      meta: expect.objectContaining({ cwd: "C:/projects/alpha", agentPreset: "standard", taskId: "TASK-2800" }),
      setup: expect.any(Function),
    }))
    expect(h.tasks.get("TASK-2800")?.agentSessionId).toBe(result.sessionId)
    expect(h.tasks.get("TASK-2800")?.status).toBe("doing")
    const handle = (await h.agents.create.mock.results[0].value) as AgentHandleLike
    expect(handle.agent.followup).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.arrayContaining([expect.objectContaining({
        text: expect.stringContaining("实现导出"),
      })]),
    }))
  })

  it("start 对已 live 的任务幂等返回；不重复创建", async () => {
    const h = makeHarness()
    h.tasks.set("TASK-2800", makeTask())
    const first = await h.manager.start("TASK-2800")
    const second = await h.manager.start("TASK-2800")
    expect(second.sessionId).toBe(first.sessionId)
    expect(h.agents.create).toHaveBeenCalledTimes(1)
    expect(h.agents.resume).not.toHaveBeenCalled()
  })

  it("start 对已有 agentSessionId 的任务走 resume，不 kick", async () => {
    const h = makeHarness()
    h.tasks.set("TASK-2800", makeTask({ agentSessionId: "task-AAAA1111", status: "doing" }))
    const result = await h.manager.start("TASK-2800")
    expect(result.sessionId).toBe("task-AAAA1111")
    expect(h.agents.create).not.toHaveBeenCalled()
    expect(h.agents.resume).toHaveBeenCalledWith(expect.objectContaining({
      resumeSessionId: "task-AAAA1111",
    }))
    const handle = (await h.agents.resume.mock.results[0].value) as AgentHandleLike
    expect(handle.agent.followup).not.toHaveBeenCalled()
  })

  it("start 未知任务抛 task-not-found", async () => {
    const h = makeHarness()
    await expect(h.manager.start("TASK-9999")).rejects.toMatchObject({ code: "task-not-found" })
  })

  it("stop 取消+释放会话、解绑 agentSessionId、回退 todo", async () => {
    const h = makeHarness()
    h.tasks.set("TASK-2800", makeTask())
    await h.manager.start("TASK-2800")
    const handle = (await h.agents.create.mock.results[0].value) as AgentHandleLike
    const stopped = await h.manager.stop("TASK-2800")
    expect(handle.agent.cancel).toHaveBeenCalledWith({ kind: "user" })
    expect(handle.dispose).toHaveBeenCalled()
    expect(stopped.status).toBe("todo")
    expect(stopped.agentSessionId).toBeUndefined()
    expect(h.tasks.get("TASK-2800")?.agentSessionId).toBeUndefined()
  })

  it("send 对 live 会话 followup；无会话抛 session-unavailable", async () => {
    const h = makeHarness()
    h.tasks.set("TASK-2800", makeTask())
    await h.manager.start("TASK-2800")
    const handle = (await h.agents.create.mock.results[0].value) as AgentHandleLike
    await h.manager.send("TASK-2800", "补充要求")
    expect(handle.agent.followup).toHaveBeenCalledTimes(2)
    await expect(h.manager.send("TASK-9999", "x")).rejects.toMatchObject({ code: "task-not-found" })
    h.tasks.set("TASK-2801", makeTask({ id: "TASK-2801" }))
    await expect(h.manager.send("TASK-2801", "x")).rejects.toMatchObject({ code: "session-unavailable" })
  })

  it("send 对持久化但未加载的任务自动 resume 后 followup", async () => {
    const h = makeHarness()
    h.tasks.set("TASK-2800", makeTask({ agentSessionId: "task-AAAA1111", status: "doing" }))
    await h.manager.send("TASK-2800", "继续")
    expect(h.agents.resume).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: "task-AAAA1111" }))
    const handle = (await h.agents.resume.mock.results[0].value) as AgentHandleLike
    expect(handle.agent.followup).toHaveBeenCalled()
  })

  it("status 返回任务+会话状态+尾部事件（不触发 resume）", async () => {
    const h = makeHarness()
    h.tasks.set("TASK-2800", makeTask({ agentSessionId: "task-AAAA1111", status: "doing" }))
    const before = await h.manager.status("TASK-2800")
    expect(before.session).toEqual({ sessionId: "task-AAAA1111", live: false, status: undefined })
    expect(h.agents.resume).not.toHaveBeenCalled()

    await h.manager.start("TASK-2800")
    const handle = (await h.agents.resume.mock.results[0].value) as AgentHandleLike
    const agent = handle.agent as ReturnType<typeof fakeAgent>
    agent.emit("agent/status", { status: "running" })
    agent.emit("session/event", { id: "task-AAAA1111" }, { seq: 1, type: "user/message", data: { text: "开始干活" } })
    const after = await h.manager.status("TASK-2800")
    expect(after.session.live).toBe(true)
    expect(after.session.status).toBe("running")
    expect(after.events).toEqual([
      { type: "status", status: "running" },
      { type: "user-message", text: "开始干活" },
    ])
  })

  it("审批监听按配置返回 allowed-once 或 rejected", async () => {
    const allow = makeHarness({ approval: "allow" })
    allow.tasks.set("TASK-2800", makeTask())
    await allow.manager.start("TASK-2800")
    const allowHandle = (await allow.agents.create.mock.results[0].value) as AgentHandleLike
    const allowAgent = allowHandle.agent as ReturnType<typeof fakeAgent>
    await expect(allowAgent.emit("approval/request", { toolName: "run_code" })).resolves.toBe("allowed-once")

    const deny = makeHarness({ approval: "never" })
    deny.tasks.set("TASK-2800", makeTask())
    await deny.manager.start("TASK-2800")
    const denyHandle = (await deny.agents.create.mock.results[0].value) as AgentHandleLike
    const denyAgent = denyHandle.agent as ReturnType<typeof fakeAgent>
    await expect(denyAgent.emit("approval/request", { toolName: "run_code" })).resolves.toBe("rejected")
  })

  it("并发 start（fresh 任务）只 create 一次、只 attachSession 一次", async () => {
    const h = makeHarness()
    h.tasks.set("TASK-2800", makeTask())
    const [first, second] = await Promise.all([
      h.manager.start("TASK-2800"),
      h.manager.start("TASK-2800"),
    ])
    expect(second.sessionId).toBe(first.sessionId)
    expect(h.agents.create).toHaveBeenCalledTimes(1)
    expect(h.agents.resume).not.toHaveBeenCalled()
    expect(h.taskStore.attachSession).toHaveBeenCalledTimes(1)
    expect(h.tasks.get("TASK-2800")?.agentSessionId).toBe(first.sessionId)
    expect(h.tasks.get("TASK-2800")?.status).toBe("doing")
  })

  it("并发 send（未加载任务）只 resume 一次，两条消息都送达", async () => {
    const h = makeHarness()
    h.tasks.set("TASK-2800", makeTask({ agentSessionId: "task-AAAA1111", status: "doing" }))
    await Promise.all([
      h.manager.send("TASK-2800", "继续"),
      h.manager.send("TASK-2800", "再继续"),
    ])
    expect(h.agents.resume).toHaveBeenCalledTimes(1)
    const handle = (await h.agents.resume.mock.results[0].value) as AgentHandleLike
    expect(handle.agent.followup).toHaveBeenCalledTimes(2)
  })

  it("start 进行中 stop：残留 start 不写 entry、释放 handle，任务保持 todo", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const h = makeHarness({ createGate: () => gate })
    h.tasks.set("TASK-2800", makeTask())
    const pending = h.manager.start("TASK-2800")
    await Promise.resolve()
    await h.manager.stop("TASK-2800")
    release()
    await pending
    expect(h.tasks.get("TASK-2800")?.agentSessionId).toBeUndefined()
    expect(h.tasks.get("TASK-2800")?.status).toBe("todo")
    const handle = (await h.agents.create.mock.results[0].value) as AgentHandleLike
    expect(handle.dispose).toHaveBeenCalled()
    const after = await h.manager.status("TASK-2800")
    expect(after.session.live).toBe(false)
  })

  it("start fresh 路径 attachSession 失败：dispose 刚创建的 handle 并原样抛错", async () => {
    const h = makeHarness()
    h.tasks.set("TASK-2800", makeTask())
    const boom = new Error("attach failed")
    h.taskStore.attachSession = vi.fn(async () => { throw boom })
    await expect(h.manager.start("TASK-2800")).rejects.toThrow(boom)
    const handle = (await h.agents.create.mock.results[0].value) as AgentHandleLike
    expect(handle.dispose).toHaveBeenCalled()
    expect(h.tasks.get("TASK-2800")?.agentSessionId).toBeUndefined()
    expect(h.tasks.get("TASK-2800")?.status).toBe("todo")
  })

  it("start fresh 路径 todo→doing update 失败：dispose 刚创建的 handle 并原样抛错", async () => {
    const h = makeHarness()
    h.tasks.set("TASK-2800", makeTask())
    const boom = new Error("update failed")
    const originalUpdate = h.taskStore.update
    h.taskStore.update = vi.fn(async (id: string, patch: Partial<TaskRecord>) => {
      if (patch.status === "doing") throw boom
      return originalUpdate(id, patch)
    })
    await expect(h.manager.start("TASK-2800")).rejects.toThrow(boom)
    const handle = (await h.agents.create.mock.results[0].value) as AgentHandleLike
    expect(handle.dispose).toHaveBeenCalled()
    expect(h.agents.create).toHaveBeenCalledWith(expect.objectContaining({ sessionId: expect.stringMatching(/^task-/) }))
    expect(h.tasks.get("TASK-2800")?.agentSessionId).toMatch(/^task-/)
    expect(h.tasks.get("TASK-2800")?.status).toBe("todo")
  })

  it("createTaskSessionId 生成 task- 前缀 8 位 id", () => {
    const id = createTaskSessionId()
    expect(id).toMatch(/^task-[A-Z2-7]{8}$/)
  })
})
