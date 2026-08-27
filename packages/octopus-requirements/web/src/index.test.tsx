import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import RequirementsModule from "./index"
import { currentProjectId } from "./api"

const RECORDS = [
  {
    id: "REQ-100",
    title: "OAuth 2.0 重构",
    description: "认证模块升级",
    priority: "P0",
    status: "backlog",
    projectId: "p-alpha",
    source: "manual",
    createdAt: "2026-08-27T08:00:00.000Z",
    updatedAt: "2026-08-27T08:00:00.000Z",
  },
  {
    id: "REQ-101",
    title: "导出报表 CSV",
    description: "",
    priority: "P2",
    status: "done",
    projectId: "p-alpha",
    source: "manual",
    createdAt: "2026-08-26T08:00:00.000Z",
    updatedAt: "2026-08-26T08:00:00.000Z",
  },
]

function mockResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function mockList() {
  return vi.fn().mockResolvedValue(mockResponse(200, { ok: true, data: RECORDS }))
}

afterEach(() => {
  delete (window as unknown as { __octopusProjectId?: string }).__octopusProjectId
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("RequirementsModule", () => {
  it("渲染列表：编号/标题/状态（无负责人列）", async () => {
    vi.stubGlobal("fetch", mockList())
    render(<RequirementsModule />)
    expect(await screen.findByText("OAuth 2.0 重构")).toBeInTheDocument()
    expect(screen.getByText("REQ-100")).toBeInTheDocument()
    expect(screen.getAllByText("待排期").length).toBeGreaterThan(0)
    expect(screen.getAllByText("已完成").length).toBeGreaterThan(0)
    expect(screen.queryByRole("columnheader", { name: "负责人" })).not.toBeInTheDocument()
    expect(screen.getByText("共 2 条")).toBeInTheDocument()
  })

  it("状态筛选：只显示匹配项", async () => {
    vi.stubGlobal("fetch", mockList())
    render(<RequirementsModule />)
    await screen.findByText("OAuth 2.0 重构")
    await userEvent.click(screen.getByRole("button", { name: "已完成" }))
    expect(screen.queryByText("OAuth 2.0 重构")).not.toBeInTheDocument()
    expect(screen.getByText("导出报表 CSV")).toBeInTheDocument()
  })

  it("加载失败显示错误与重试", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(500, { ok: false, error: { code: "internal", message: "boom" } })))
    render(<RequirementsModule />)
    expect(await screen.findByText("boom")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument()
  })

  it("新建流程：打开弹窗提交后插入列表，body 注入 projectId", async () => {
    ;(window as unknown as { __octopusProjectId?: string }).__octopusProjectId = "p-alpha"
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, { ok: true, data: RECORDS }))
      .mockResolvedValueOnce(
        mockResponse(201, {
          ok: true,
          data: {
            id: "REQ-102",
            title: "新需求",
            description: "",
            priority: "P2",
            status: "backlog",
            projectId: "p-alpha",
            source: "manual",
            createdAt: "2026-08-27T09:00:00.000Z",
            updatedAt: "2026-08-27T09:00:00.000Z",
          },
        }),
      )
    vi.stubGlobal("fetch", fetchMock)
    render(<RequirementsModule />)
    expect(currentProjectId()).toBe("p-alpha")
    await screen.findByText("OAuth 2.0 重构")

    await userEvent.click(screen.getByRole("button", { name: /新建需求/ }))
    await userEvent.type(screen.getByPlaceholderText(/多租户权限体系升级/), "新需求")
    await userEvent.click(screen.getByRole("button", { name: "创建需求" }))

    await waitFor(() => expect(screen.getByText("新需求")).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/octopus-requirements/requirements",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "新需求", description: "", priority: "P1", projectId: "p-alpha" }),
      }),
    )
  })

  it("编辑流程：打开编辑弹窗提交后更新列表", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, { ok: true, data: RECORDS }))
      .mockResolvedValueOnce(
        mockResponse(200, {
          ok: true,
          data: { ...RECORDS[0], title: "OAuth 2.0 重构 v2" },
        }),
      )
    vi.stubGlobal("fetch", fetchMock)
    render(<RequirementsModule />)
    await screen.findByText("OAuth 2.0 重构")

    await userEvent.click(screen.getByRole("button", { name: "编辑 REQ-100" }))
    const titleInput = screen.getByPlaceholderText(/多租户权限体系升级/)
    await userEvent.clear(titleInput)
    await userEvent.type(titleInput, "OAuth 2.0 重构 v2")
    await userEvent.click(screen.getByRole("button", { name: "保存修改" }))

    await waitFor(() => expect(screen.getByText("OAuth 2.0 重构 v2")).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/octopus-requirements/requirements/REQ-100",
      expect.objectContaining({ method: "PATCH" }),
    )
  })

  it("删除需确认，确认后调用 DELETE", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, { ok: true, data: RECORDS }))
      .mockResolvedValueOnce(mockResponse(200, { ok: true, data: true }))
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(window, "confirm").mockReturnValue(true)
    render(<RequirementsModule />)
    await screen.findByText("OAuth 2.0 重构")

    await userEvent.click(screen.getByRole("button", { name: "删除 REQ-100" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/octopus-requirements/requirements/REQ-100",
      expect.objectContaining({ method: "DELETE" }),
    ))
    await waitFor(() => expect(screen.queryByText("OAuth 2.0 重构")).not.toBeInTheDocument())
  })
})
