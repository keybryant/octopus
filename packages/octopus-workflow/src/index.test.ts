import { describe, expect, it, vi } from "vitest"
import { Context } from "@deepseek-ai/cordis"
import plugin from "./index.js"
import { MAIN_TOOL_NAMES } from "./tools.js"

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
  ctx.provide("taskStore", {
    get: (id: string) => id === "TASK-2800"
      ? { id: "TASK-2800", title: "实现导出", description: "", requirementId: "REQ-100", projectId: "prjA", status: "todo", createdAt: "", updatedAt: "" }
      : undefined,
    update: vi.fn(),
    attachSession: vi.fn(),
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
  return { ctx, registered, createAgent }
}

describe("octopus-workflow index", () => {
  it("apply 注册 16 个主工具且名字与 MAIN_TOOL_NAMES 一致", async () => {
    const { ctx, registered } = makeCtx()
    await ctx.plugin(plugin)
    expect(registered.map((t) => t.name)).toEqual([...MAIN_TOOL_NAMES])
    expect(registered).toHaveLength(16)
  })

  it("无项目上下文（store 桩）时工具报 project-scope", async () => {
    const { ctx, registered } = makeCtx()
    await ctx.plugin(plugin)
    const start = registered.find((t) => t.name === "start_task_session") as unknown as
      { execute(args: { taskId: string }, exec: unknown): Promise<unknown> }
    await expect(start.execute({ taskId: "TASK-9999" }, {} as never)).rejects.toThrow(/project-scope/)
  })

  it("子会话创建沿用平台默认模型（agentDefaultModel 兜底，{{model}} 变量有值）", async () => {
    const { ctx, registered, createAgent } = makeCtx()
    await ctx.plugin(plugin)
    const start = registered.find((t) => t.name === "start_task_session") as unknown as
      { execute(args: { taskId: string }, exec: unknown): Promise<unknown> }
    await start.execute({ taskId: "TASK-2800" }, {
      agent: { session: { header: { cwd: "C:/ws/a" } } },
    })
    expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({
      agentOptions: { provider: "deepseek-official", model: "deepseek-v4-flash" },
    }))
  })
})
