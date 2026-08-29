import { describe, expect, it, vi } from "vitest"
import { Context } from "@deepseek-ai/cordis"
import plugin from "./index.js"
import { MAIN_TOOL_NAMES } from "./tools.js"

function makeCtx() {
  const registered: { name: string }[] = []
  const ctx = new Context()
  ctx.provide("tools", {
    register: (definition: { name: string }) => { registered.push(definition); return () => {} },
  } as never)
  ctx.provide("agents", { create: vi.fn(), resume: vi.fn() } as never)
  ctx.provide("requirementStore", { get: () => undefined } as never)
  ctx.provide("taskStore", {
    get: () => undefined, update: vi.fn(), attachSession: vi.fn(), setAgentSummary: vi.fn(), reopen: vi.fn(),
  } as never)
  ctx.provide("projectStore", { get: () => undefined, list: () => [] } as never)
  return { ctx, registered }
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
})
