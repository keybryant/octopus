import { describe, expect, it, vi } from "vitest"
import { buildTaskSetup, type AgentCtxLike } from "./sub-tools.js"
import { MAIN_TOOL_NAMES } from "./tools.js"
import type { RequirementStoreLike, TaskStoreLike } from "./types.js"
import type { RequirementRecord } from "octopus-requirements"
import type { TaskRecord } from "octopus-tasks"

const makeTask = (): TaskRecord => ({
  id: "TASK-2800", title: "实现导出", description: "支持 CSV", requirementId: "REQ-100",
  projectId: "prjA", status: "doing",
  createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z",
})

function makeHarness() {
  const taskStore: TaskStoreLike = {
    get: vi.fn(() => makeTask()),
    update: vi.fn(async (_id, patch) => ({ ...makeTask(), ...patch }) as TaskRecord),
    attachSession: vi.fn(),
    setAgentSummary: vi.fn(async (_id, summary) => ({ ...makeTask(), agentSummary: summary }) as TaskRecord),
    reopen: vi.fn(),
  }
  const requirementStore: RequirementStoreLike = {
    get: vi.fn(() => ({ id: "REQ-100", title: "导出报表", description: "", priority: "P1", status: "planned", projectId: "prjA", source: "chat", createdAt: "", updatedAt: "" }) as RequirementRecord),
  }
  const registered: { name: string; execute(args: unknown, exec: unknown): Promise<unknown> }[] = []
  const restrictCapture: { value: { allow?: string[]; deny?: string[] } | null } = { value: null }
  const agentCtx: AgentCtxLike = {
    tools: {
      register: (definition) => { registered.push(definition as never); return () => {} },
      restrict: (filter) => { restrictCapture.value = filter; return () => {} },
    },
  }
  buildTaskSetup({ taskStore, requirementStore }, "TASK-2800")(agentCtx)
  const byName = (name: string) => registered.find((t) => t.name === name)!
  return { taskStore, requirementStore, registered, restrictFilter: restrictCapture.value, byName }
}

const exec = (tool: { execute(args: unknown, exec: unknown): Promise<unknown> }, args: unknown) => tool.execute(args, {} as never)

describe("buildTaskSetup", () => {
  it("注册 2 个作用域工具并 restrict 屏蔽全部主工具", () => {
    const h = makeHarness()
    expect(h.registered.map((t) => t.name)).toEqual(["get_task_context", "report_task_status"])
    expect(h.restrictFilter?.deny).toEqual([...MAIN_TOOL_NAMES])
  })

  it("get_task_context 返回任务与所属需求", async () => {
    const h = makeHarness()
    const result = await exec(h.byName("get_task_context"), {}) as { task: TaskRecord; requirement: RequirementRecord }
    expect(result.task.id).toBe("TASK-2800")
    expect(result.requirement.title).toBe("导出报表")
  })

  it("report_task_status 先写 summary 再推进状态", async () => {
    const h = makeHarness()
    const result = await exec(h.byName("report_task_status"), { status: "review", summary: " 已完成导出 " }) as TaskRecord
    expect(h.taskStore.setAgentSummary).toHaveBeenCalledWith("TASK-2800", " 已完成导出 ")
    expect(h.taskStore.update).toHaveBeenCalledWith("TASK-2800", { status: "review" })
    expect(result.status).toBe("review")
  })

  it("report_task_status 全空白 summary 不写总结且状态仍推进", async () => {
    const h = makeHarness()
    const result = await exec(h.byName("report_task_status"), { status: "review", summary: "   " }) as TaskRecord
    expect(h.taskStore.setAgentSummary).not.toHaveBeenCalled()
    expect(h.taskStore.update).toHaveBeenCalledWith("TASK-2800", { status: "review" })
    expect(result.status).toBe("review")
  })

  it("report_task_status 无 summary 时不写总结", async () => {
    const h = makeHarness()
    await exec(h.byName("report_task_status"), { status: "done" })
    expect(h.taskStore.setAgentSummary).not.toHaveBeenCalled()
    expect(h.taskStore.update).toHaveBeenCalledWith("TASK-2800", { status: "done" })
  })

  it("任务不存在时工具抛 [task-not-found]", async () => {
    const h = makeHarness()
    h.taskStore.get = vi.fn(() => undefined)
    await expect(exec(h.byName("get_task_context"), {})).rejects.toThrow(/\[task-not-found\]/)
  })
})
