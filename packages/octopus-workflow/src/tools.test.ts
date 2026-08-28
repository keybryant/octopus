import { describe, expect, it, vi } from "vitest"
import { createMainTools, MAIN_TOOL_NAMES, toolError, type MainToolsDeps } from "./tools.js"
import type { TaskSessionLike } from "./types.js"
import { WorkflowError } from "./types.js"
import type { RequirementRecord } from "octopus-requirements"
import type { TaskRecord } from "octopus-tasks"
import type { ProjectView } from "octopus-projects"

const makeRequirement = (): RequirementRecord => ({
  id: "REQ-100", title: "导出报表", description: "", priority: "P1",
  status: "planned", projectId: "prjA", source: "chat",
  createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z",
})

const makeTask = (overrides: Partial<TaskRecord> = {}): TaskRecord => ({
  id: "TASK-2800", title: "实现导出", description: "", requirementId: "REQ-100",
  projectId: "prjA", status: "todo",
  createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z",
  ...overrides,
})

const makeProject = (): ProjectView => ({
  id: "prjA", name: "Alpha", description: "", status: "active",
  workspacePath: "C:/projects/alpha", workspaceId: "ws-1", createdAt: "2026-08-26T00:00:00.000Z",
})

function makeHarness() {
  const requirements: MainToolsDeps["requirements"] = {
    get: vi.fn((id: string) => (id === "REQ-100" ? makeRequirement() : undefined)),
  }
  const tasks: MainToolsDeps["tasks"] = {
    get: vi.fn((id: string) => (id === "TASK-2800" ? makeTask() : undefined)),
    update: vi.fn(),
    attachSession: vi.fn(),
    setAgentSummary: vi.fn(),
    reopen: vi.fn(),
  }
  const projects: MainToolsDeps["projects"] = {
    get: vi.fn((id: string) => (id === "prjA" ? makeProject() : undefined)),
    list: vi.fn(() => [makeProject()]),
  }
  const sessions: TaskSessionLike = {
    start: vi.fn(),
    stop: vi.fn(),
    send: vi.fn(),
    status: vi.fn(),
  }
  const tools = createMainTools({ requirements, tasks, projects, sessions })
  const byName = (name: string) => tools.find((t) => t.name === name)!
  return { requirements, tasks, projects, sessions, tools, byName }
}

const exec = (tool: { execute(args: unknown, exec: unknown): Promise<unknown> }, args: unknown) => tool.execute(args, {} as never)

describe("createMainTools", () => {
  it("注册 14 个工具且 MAIN_TOOL_NAMES 一致", () => {
    const { tools } = makeHarness()
    expect(MAIN_TOOL_NAMES).toHaveLength(14)
    expect(new Set(tools.map((t) => t.name))).toEqual(new Set(MAIN_TOOL_NAMES))
  })

  it("create_requirement：project 校验 + source=chat", async () => {
    const h = makeHarness()
    const create = vi.fn(async () => makeRequirement())
    h.requirements.create = create
    await expect(exec(h.byName("create_requirement"), { title: "x", projectId: "prjZ" }))
      .rejects.toThrow(/project-not-found/)
    await exec(h.byName("create_requirement"), { title: "新需求", projectId: "prjA", priority: "P0" })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: "新需求", projectId: "prjA", priority: "P0", source: "chat" }))
  })

  it("list_requirements 按 projectId 过滤", async () => {
    const h = makeHarness()
    const record = makeRequirement()
    h.requirements.list = vi.fn((filter?: (r: RequirementRecord) => boolean) =>
      [record, { ...record, id: "REQ-101", projectId: "prjB" }].filter(filter ?? (() => true)))
    const result = await exec(h.byName("list_requirements"), { projectId: "prjA" }) as RequirementRecord[]
    expect(result.map((r) => r.id)).toEqual(["REQ-100"])
  })

  it("get_task 不存在抛 [not-found]", async () => {
    const h = makeHarness()
    await expect(exec(h.byName("get_task"), { id: "TASK-9999" })).rejects.toThrow(/not-found/)
  })

  it("create_tasks 校验 project 后委托 createBatch", async () => {
    const h = makeHarness()
    const batch = vi.fn(async () => [makeTask()])
    h.tasks.createBatch = batch
    await exec(h.byName("create_tasks"), {
      requirementId: "REQ-100", projectId: "prjA",
      tasks: [{ title: "实现导出" }, { title: "联调测试" }],
    })
    expect(batch).toHaveBeenCalledWith({ requirementId: "REQ-100", projectId: "prjA", tasks: [{ title: "实现导出" }, { title: "联调测试" }] })
  })

  it("update_task 透传非法迁移错误码", async () => {
    const h = makeHarness()
    h.tasks.update = vi.fn(async (): Promise<TaskRecord> => {
      throw new WorkflowError("invalid-input", "boom")
    })
    await expect(exec(h.byName("update_task"), { id: "TASK-2800", status: "done" })).rejects.toThrow(/\[invalid-input\] boom/)
  })

  it("start_task_session / stop / send / status 委托 sessions", async () => {
    const h = makeHarness()
    await exec(h.byName("start_task_session"), { taskId: "TASK-2800" })
    expect(h.sessions.start).toHaveBeenCalledWith("TASK-2800")
    await exec(h.byName("stop_task_session"), { taskId: "TASK-2800" })
    expect(h.sessions.stop).toHaveBeenCalledWith("TASK-2800")
    await exec(h.byName("send_to_task_session"), { taskId: "TASK-2800", message: "继续" })
    expect(h.sessions.send).toHaveBeenCalledWith("TASK-2800", "继续")
    await exec(h.byName("task_session_status"), { taskId: "TASK-2800" })
    expect(h.sessions.status).toHaveBeenCalledWith("TASK-2800")
  })

  it("toolError 包装错误码", () => {
    expect(() => toolError(new WorkflowError("session-unavailable", "no session"))).toThrow(/\[session-unavailable\] no session/)
    expect(() => toolError(new Error("plain"))).toThrow(/plain/)
  })
})
