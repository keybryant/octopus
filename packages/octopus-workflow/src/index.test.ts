import { describe, expect, it, vi } from "vitest"
import { Context } from "@deepseek-ai/cordis"
import { TASK_STATUS_CHANGED_EVENT, type TaskRecord } from "octopus-tasks"
import plugin from "./index.js"
import { MAIN_TOOL_NAMES } from "./tools.js"

const makeTask = (overrides: Partial<TaskRecord> = {}): TaskRecord => ({
  id: "TASK-2800", title: "实现导出", description: "", requirementId: "REQ-100",
  projectId: "prjA", status: "todo", createdAt: "", updatedAt: "",
  ...overrides,
})

function makeCtx() {
  const registered: { name: string }[] = []
  const createAgent = vi.fn(async (options: { sessionId: string }) => ({
    agent: {
      id: options.sessionId,
      status: "idle",
      ctx: { on: () => 0 },
      followup: () => undefined,
      cancel: () => undefined,
    },
    dispose: vi.fn(async () => undefined),
  }))
  const ctx = new Context()
  ctx.provide("tools", {
    register: (definition: { name: string }) => { registered.push(definition); return () => {} },
  } as never)
  ctx.provide("agents", { create: createAgent, resume: vi.fn() } as never)
  ctx.provide("requirementStore", { get: () => undefined } as never)
  const tasks = new Map<string, TaskRecord>()
  ctx.provide("taskStore", {
    get: (id: string) => tasks.get(id),
    update: vi.fn(async (id: string, patch: Partial<TaskRecord>) => {
      const current = tasks.get(id)
      if (!current) throw new Error(`task ${id} not found`)
      const next: TaskRecord = { ...current, ...patch, updatedAt: "" }
      tasks.set(id, next)
      return next
    }),
    attachSession: vi.fn(async (id: string, sessionId: string | null) => {
      const current = tasks.get(id)
      if (!current) throw new Error(`task ${id} not found`)
      const next: TaskRecord = { ...current, agentSessionId: sessionId ?? undefined, updatedAt: "" }
      tasks.set(id, next)
      return next
    }),
    setAgentSummary: vi.fn(),
    reopen: vi.fn(),
  } as never)
  ctx.provide("projectStore", {
    get: (id: string) => id === "prjA" ? { id: "prjA", name: "A", description: "", status: "active", workspacePath: "C:/ws/a", workspaceId: "w", createdAt: "" } : undefined,
    list: () => [{ id: "prjA", name: "A", description: "", status: "active", workspacePath: "C:/ws/a", workspaceId: "w", createdAt: "" }],
  } as never)
  ctx.provide("agentDefaultModel", {
    currentSelection: () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }),
  } as never)
  return { ctx, registered, createAgent, tasks }
}

describe("octopus-workflow index", () => {
  it("apply 注册 15 个主工具且名字与 MAIN_TOOL_NAMES 一致", async () => {
    const { ctx, registered } = makeCtx()
    await ctx.plugin(plugin)
    expect(registered.map((t) => t.name)).toEqual([...MAIN_TOOL_NAMES])
    expect(registered).toHaveLength(15)
  })

  it("无项目上下文（store 桩）时工具报 project-scope", async () => {
    const { ctx, registered } = makeCtx()
    await ctx.plugin(plugin)
    const status = registered.find((t) => t.name === "task_session_status") as unknown as
      { execute(args: { taskId: string }, exec: unknown): Promise<unknown> }
    await expect(status.execute({ taskId: "TASK-9999" }, {} as never)).rejects.toThrow(/project-scope/)
  })

  it("任务置 doing 事件自动为该任务创建执行会话（复用平台默认模型）", async () => {
    const { ctx, createAgent, tasks } = makeCtx()
    tasks.set("TASK-2800", makeTask())
    await ctx.plugin(plugin)
    ctx.emit(TASK_STATUS_CHANGED_EVENT, makeTask({ status: "doing" }))
    await vi.waitFor(() => expect(createAgent).toHaveBeenCalled())
    expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: expect.stringMatching(/^task-/),
      meta: expect.objectContaining({ cwd: "C:/ws/a", agentPreset: "standard", taskId: "TASK-2800" }),
      agentOptions: { provider: "deepseek-official", model: "deepseek-v4-flash" },
    }))
  })

  it("doing 事件按任务指定 agent 创建会话；非 doing 事件不触发", async () => {
    const { ctx, createAgent, tasks } = makeCtx()
    tasks.set("TASK-2800", makeTask({ agent: "octopus-developer" }))
    await ctx.plugin(plugin)
    ctx.emit(TASK_STATUS_CHANGED_EVENT, makeTask({ agent: "octopus-developer", status: "review" }))
    expect(createAgent).not.toHaveBeenCalled()
    ctx.emit(TASK_STATUS_CHANGED_EVENT, makeTask({ agent: "octopus-developer", status: "doing" }))
    await vi.waitFor(() => expect(createAgent).toHaveBeenCalled())
    expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({ agentPreset: "octopus-developer", taskId: "TASK-2800" }),
    }))
  })
})
