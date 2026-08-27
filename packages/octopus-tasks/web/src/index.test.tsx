import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import TasksModule from "./index"

const TASKS = [
  { id: "TASK-2800", title: "导出 CSV", description: "", requirementId: "REQ-100", projectId: "p-alpha", priority: "P0", status: "todo", assignee: "LW", createdAt: "2026-08-28T08:00:00.000Z", updatedAt: "2026-08-28T08:00:00.000Z" },
  { id: "TASK-2801", title: "联调测试", description: "", requirementId: "REQ-100", projectId: "p-alpha", priority: "P2", status: "doing", assignee: null, createdAt: "2026-08-28T08:00:00.000Z", updatedAt: "2026-08-28T08:00:00.000Z" },
  { id: "TASK-2802", title: "验收上线", description: "", requirementId: "REQ-100", projectId: "p-alpha", priority: "P2", status: "done", assignee: null, createdAt: "2026-08-28T08:00:00.000Z", updatedAt: "2026-08-28T08:00:00.000Z" },
]

function mockResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function makeDataTransfer() {
  let captured = ""
  return {
    setData: (_k: string, id: string) => void (captured = id),
    getData: () => captured,
    effectAllowed: "",
  }
}

afterEach(() => {
  delete (window as unknown as { __octopusProjectId?: string }).__octopusProjectId
  vi.unstubAllGlobals()
})

describe("TasksModule", () => {
  it("渲染四列看板与任务卡（id/优先级/负责人）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(200, { ok: true, data: TASKS })))
    render(<TasksModule />)
    expect(await screen.findByText("导出 CSV")).toBeInTheDocument()
    for (const label of ["待处理", "进行中", "评审中", "已完成"]) {
      expect(screen.getByRole("group", { name: label })).toBeInTheDocument()
    }
    expect(screen.getByText("TASK-2800")).toBeInTheDocument()
    expect(screen.getByText("LW")).toBeInTheDocument()
    expect(screen.getByText("共 3 个")).toBeInTheDocument()
  })

  it("拖拽迁卡：drop → PATCH status，乐观更新列归属", async () => {
    vi.stubGlobal("location", { ...window.location, search: "" })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, { ok: true, data: TASKS }))
      .mockResolvedValueOnce(mockResponse(200, { ok: true, data: { ...TASKS[0], status: "doing" } }))
    vi.stubGlobal("fetch", fetchMock)
    render(<TasksModule />)
    await screen.findByText("导出 CSV")

    const todoCol = screen.getByRole("group", { name: "待处理" })
    const doingCol = screen.getByRole("group", { name: "进行中" })
    expect(within(todoCol).getByText("导出 CSV")).toBeInTheDocument()

    const card = screen.getByText("导出 CSV").closest("[draggable=true]")!
    const dataTransfer = makeDataTransfer()
    fireEvent.dragStart(card, { dataTransfer })
    fireEvent.dragOver(doingCol, { dataTransfer })
    fireEvent.drop(doingCol, { dataTransfer })

    await waitFor(() => expect(within(doingCol).getByText("导出 CSV")).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/octopus-tasks/tasks/TASK-2800",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "doing" }) }),
    )
  })

  it("拖拽失败：回滚原列并显示错误", async () => {
    vi.stubGlobal("location", { ...window.location, search: "" })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(200, { ok: true, data: TASKS }))
      .mockResolvedValueOnce(mockResponse(422, { ok: false, error: { code: "invalid-transition", message: "invalid status transition" } }))
    vi.stubGlobal("fetch", fetchMock)
    render(<TasksModule />)
    await screen.findByText("导出 CSV")

    const todoCol = screen.getByRole("group", { name: "待处理" })
    const doingCol = screen.getByRole("group", { name: "进行中" })
    const card = screen.getByText("导出 CSV").closest("[draggable=true]")!
    const dataTransfer = makeDataTransfer()
    fireEvent.dragStart(card, { dataTransfer })
    fireEvent.dragOver(doingCol, { dataTransfer })
    fireEvent.drop(doingCol, { dataTransfer })

    await waitFor(() => expect(screen.getByText("invalid status transition")).toBeInTheDocument())
    expect(within(todoCol).getByText("导出 CSV")).toBeInTheDocument()
    expect(within(doingCol).queryByText("导出 CSV")).not.toBeInTheDocument()
  })

  it("加载失败显示错误与重试", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(500, { ok: false, error: { code: "internal", message: "boom" } })))
    render(<TasksModule />)
    expect(await screen.findByText("boom")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument()
  })
})
