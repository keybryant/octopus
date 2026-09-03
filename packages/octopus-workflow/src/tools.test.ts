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
    transcript: vi.fn(),
    ask: vi.fn(),
  }
  const tools = createMainTools({ requirements, tasks, projects, sessions })
  const byName = (name: string) => tools.find((t) => t.name === name)!
  return { requirements, tasks, projects, sessions, tools, byName }
}

const exec = (
  tool: { execute(args: unknown, exec: unknown): Promise<unknown> },
  args: unknown,
  cwd = "C:/projects/alpha",
) => tool.execute(args, { agent: { session: { header: { cwd } } } })

const execNoContext = (tool: { execute(args: unknown, exec: unknown): Promise<unknown> }, args: unknown) =>
  tool.execute(args, {} as never)

describe("createMainTools", () => {
  it("注册 15 个工具且 MAIN_TOOL_NAMES 一致（不含 start_task_session）", () => {
    const { tools } = makeHarness()
    expect(MAIN_TOOL_NAMES).toHaveLength(15)
    expect(MAIN_TOOL_NAMES).not.toContain("start_task_session")
    expect(new Set(tools.map((t) => t.name))).toEqual(new Set(MAIN_TOOL_NAMES))
  })

  it("create_requirement：项目从会话 cwd 推导（source=chat），无需传 projectId", async () => {
    const h = makeHarness()
    const create = vi.fn(async () => makeRequirement())
    h.requirements.create = create
    await exec(h.byName("create_requirement"), { title: "新需求", priority: "P0" })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: "新需求", projectId: "prjA", priority: "P0", source: "chat" }))
  })

  it("list_requirements / list_tasks / create_tasks 自动限定当前项目", async () => {
    const h = makeHarness()
    const record = makeRequirement()
    h.requirements.list = vi.fn((filter?: (r: RequirementRecord) => boolean) =>
      [record, { ...record, id: "REQ-101", projectId: "prjB" }].filter(filter ?? (() => true)))
    h.tasks.list = vi.fn((filter?: (r: TaskRecord) => boolean) =>
      [makeTask(), { ...makeTask(), id: "TASK-2801", projectId: "prjB" }].filter(filter ?? (() => true)))
    const reqs = await exec(h.byName("list_requirements"), {}) as RequirementRecord[]
    expect(reqs.map((r) => r.id)).toEqual(["REQ-100"])
    const tasks = await exec(h.byName("list_tasks"), {}) as TaskRecord[]
    expect(tasks.map((t) => t.id)).toEqual(["TASK-2800"])

    const batch = vi.fn(async () => [makeTask()])
    h.tasks.createBatch = batch
    await exec(h.byName("create_tasks"), {
      requirementId: "REQ-100",
      tasks: [{ title: "实现导出", agent: "octopus-developer" }, { title: "联调测试" }],
    })
    expect(batch).toHaveBeenCalledWith({
      requirementId: "REQ-100",
      projectId: "prjA",
      tasks: [{ title: "实现导出", agent: "octopus-developer" }, { title: "联调测试" }],
    })
  })

  it("list_projects 只返回当前项目；get_project 拒绝其他项目", async () => {
    const h = makeHarness()
    const list = await exec(h.byName("list_projects"), {}) as ProjectView[]
    expect(list.map((p) => p.id)).toEqual(["prjA"])
    const got = await exec(h.byName("get_project"), { id: "prjA" }) as ProjectView
    expect(got.id).toBe("prjA")
    await expect(exec(h.byName("get_project"), { id: "prjB" })).rejects.toThrow(/project-scope/)
  })

  it("无项目上下文（无 cwd）→ project-scope 引导切项目", async () => {
    const h = makeHarness()
    await expect(execNoContext(h.byName("create_requirement"), { title: "x" })).rejects.toThrow(/project-scope/)
    await expect(execNoContext(h.byName("list_tasks"), {})).rejects.toThrow(/project-scope/)
  })

  it("其他项目的资源访问 → project-scope", async () => {
    const h = makeHarness()
    h.tasks.get = vi.fn(() => makeTask({ id: "TASK-2800", projectId: "prjB" }))
    await expect(exec(h.byName("get_task"), { id: "TASK-2800" })).rejects.toThrow(/project-scope/)
    await expect(exec(h.byName("task_session_status"), { taskId: "TASK-2800" })).rejects.toThrow(/project-scope/)
    h.requirements.get = vi.fn(() => ({ ...makeRequirement(), projectId: "prjB" }))
    await expect(exec(h.byName("update_requirement"), { id: "REQ-100", status: "planned" })).rejects.toThrow(/project-scope/)
  })

  it("get_task 不存在抛 [not-found]", async () => {
    const h = makeHarness()
    await expect(exec(h.byName("get_task"), { id: "TASK-9999" })).rejects.toThrow(/not-found/)
  })

  it("update_task 透传非法迁移错误码", async () => {
    const h = makeHarness()
    h.tasks.update = vi.fn(async (): Promise<TaskRecord> => {
      throw new WorkflowError("invalid-input", "boom")
    })
    await expect(exec(h.byName("update_task"), { id: "TASK-2800", status: "done" })).rejects.toThrow(/\[invalid-input\] boom/)
  })

  it("stop / send / status 委托 sessions", async () => {
    const h = makeHarness()
    await exec(h.byName("stop_task_session"), { taskId: "TASK-2800" })
    expect(h.sessions.stop).toHaveBeenCalledWith("TASK-2800")
    await exec(h.byName("send_to_task_session"), { taskId: "TASK-2800", message: "继续" })
    expect(h.sessions.send).toHaveBeenCalledWith("TASK-2800", "继续")
    await exec(h.byName("task_session_status"), { taskId: "TASK-2800" })
    expect(h.sessions.status).toHaveBeenCalledWith("TASK-2800")
  })

  it("ask_task_session / task_session_log 委托 sessions（含分页与超时默认值）", async () => {
    const h = makeHarness()
    const { sessions } = h
    ;(sessions.ask as ReturnType<typeof vi.fn>).mockResolvedValue({ reply: "已改完，测试通过", events: [{ type: "assistant-text", text: "已改完，测试通过" }] })
    ;(sessions.transcript as ReturnType<typeof vi.fn>).mockResolvedValue({ events: [{ type: "user-message", text: "开工" }], total: 1 })

    const asked = await exec(h.byName("ask_task_session"), { taskId: "TASK-2800", message: "进展如何？" })
    expect(sessions.ask).toHaveBeenCalledWith("TASK-2800", "进展如何？", 180_000)
    expect(asked).toMatchObject({ reply: expect.stringContaining("已改完") })

    const askedCustom = await exec(h.byName("ask_task_session"), { taskId: "TASK-2800", message: "hi", timeoutMs: 5000 })
    expect(sessions.ask).toHaveBeenCalledWith("TASK-2800", "hi", 5000)

    const log = await exec(h.byName("task_session_log"), { taskId: "TASK-2800", after: 5, limit: 20 })
    expect(sessions.transcript).toHaveBeenCalledWith("TASK-2800", { after: 5, limit: 20 })
    expect(log).toMatchObject({ total: 1 })
  })

  it("列表工具 render 携带详细记录（模型可见完整数据而非计数）", () => {
    const h = makeHarness()
    h.tasks.list = vi.fn(() => [makeTask(), { ...makeTask(), id: "TASK-2801", title: "联调测试", status: "doing", agentSessionId: "task-AAAA1111", agentSummary: "已完成" }])
    h.requirements.list = vi.fn(() => [makeRequirement()])
    const renderText = (tool: { output: { render(args: unknown, value: unknown): { text: string }[] } }, value: unknown): string =>
      tool.output.render({}, value).map((b) => b.text).join("\n")

    const tasksText = renderText(h.byName("list_tasks"), h.tasks.list())
    expect(tasksText).toContain("TASK-2800 | 实现导出 | todo")
    expect(tasksText).toContain("TASK-2801 | 联调测试 | doing")
    expect(tasksText).toContain("task-AAAA1111")
    expect(tasksText).toContain("已完成")

    const reqsText = renderText(h.byName("list_requirements"), h.requirements.list())
    expect(reqsText).toContain("REQ-100 | 导出报表 | planned | P1")

    const taskText = renderText(h.byName("get_task"), makeTask({ agentSessionId: "task-AAAA1111" }))
    expect(taskText).toContain("session=task-AAAA1111")
  })

  it("toolError 包装错误码", () => {
    expect(() => toolError(new WorkflowError("session-unavailable", "no session"))).toThrow(/\[session-unavailable\] no session/)
    expect(() => toolError(new Error("plain"))).toThrow(/plain/)
  })
})
