import { render, screen, waitFor } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import App from "./App"
import { deleteProject, fetchConfig, fetchProjects, updateProject } from "./api"

vi.mock("./api", () => ({
  fetchConfig: vi.fn().mockResolvedValue(null),
  fetchModules: vi.fn().mockResolvedValue([]),
  fetchProjects: vi.fn().mockResolvedValue(null), // 默认走 mock 回退，保住既有用例
  createProject: vi.fn(),
  updateProject: vi.fn().mockResolvedValue(true),
  deleteProject: vi.fn().mockResolvedValue(true),
}))
const mockedFetchConfig = vi.mocked(fetchConfig)
const mockedFetchProjects = vi.mocked(fetchProjects)
const mockedUpdateProject = vi.mocked(updateProject)
const mockedDeleteProject = vi.mocked(deleteProject)

describe("App (v5 agent homepage)", () => {
  afterEach(() => {
    vi.clearAllMocks()
    mockedFetchProjects.mockResolvedValue(null)
  })

  it("renders v5 shell with brand, project strip metrics and chat welcome", async () => {
    render(<App />)
    expect(screen.getAllByText("Octopus Platform").length).toBeGreaterThan(0) // 切换器 + strip
    await waitFor(() =>
      expect(screen.getByText(/当前上下文：Octopus Platform · 迭代 4.2/)).toBeInTheDocument(),
    )
    expect(mockedFetchConfig).toHaveBeenCalled()
  })

  it("opens kanban drawer from strip and closes on Esc", async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole("button", { name: /任务看板/ }))
    expect(await screen.findByRole("heading", { name: "任务看板" })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: "Escape" })
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "任务看板" })).not.toBeInTheDocument(),
    )
  })

  it("chat send round-trip shows assistant cards and artifacts rail", async () => {
    const user = userEvent.setup()
    render(<App />)
    const box = screen.getByPlaceholderText(/给 Octo Agent 下指令/)
    await user.type(box, "列出优先事项")
    fireEvent.keyDown(box, { key: "Enter" })
    expect(await screen.findByText("让 Agent 接手 →")).toBeInTheDocument()
    expect(screen.getByText("本会话产出")).toBeInTheDocument()
  })

  it("artifacts rail collapses and restores", async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByTitle("收起"))
    expect(screen.queryByText("本会话产出")).not.toBeInTheDocument()
    await user.click(screen.getByTitle("展开产出面板"))
    expect(screen.getByText("本会话产出")).toBeInTheDocument()
  })

  it("project switcher swaps strip metrics", async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByTestId("project-switcher"))
    await user.click(screen.getByText("Merchant Portal"))
    // 切换后指标随项目变化
    expect(screen.getByText("迭代 2.8 · 第 3 周")).toBeInTheDocument()
    expect(screen.getByText("12")).toBeInTheDocument()
    expect(screen.getByText("/30")).toBeInTheDocument()
  })

  it("loads projects from api when available", async () => {
    mockedFetchProjects.mockResolvedValue([
      {
        id: "p-api",
        name: "API Project",
        description: "",
        status: "active",
        workspacePath: "~/r/API Project",
        workspaceId: "w",
        createdAt: "2026-08-26T00:00:00.000Z",
      },
    ])
    render(<App />)
    expect(await screen.findAllByText("API Project").then((els) => els.length)).toBeGreaterThan(0)
  })

  it("settings modal saves status change via PATCH", async () => {
    mockedFetchProjects.mockResolvedValue([
      {
        id: "p-api",
        name: "API Project",
        description: "d",
        status: "active",
        workspacePath: "~/r/API Project",
        workspaceId: "w",
        createdAt: "2026-08-26T00:00:00.000Z",
      },
    ])
    render(<App />)
    const user = userEvent.setup()
    await user.click(await screen.findByTitle("设置"))
    await user.click(screen.getByText("项目设置"))
    fireEvent.click(await screen.findByText("已暂停"))
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() =>
      expect(mockedUpdateProject).toHaveBeenCalledWith("p-api", { description: "d", status: "paused" }),
    )
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument(),
    )
  })

  it("settings modal deletes project and falls back to remaining list", async () => {
    mockedFetchProjects.mockResolvedValue([
      {
        id: "p-a",
        name: "Alpha",
        description: "",
        status: "active",
        workspacePath: "~/r/A",
        workspaceId: "w",
        createdAt: "2026-08-25T00:00:00.000Z",
      },
      {
        id: "p-b",
        name: "Beta",
        description: "",
        status: "active",
        workspacePath: "~/r/B",
        workspaceId: "w",
        createdAt: "2026-08-26T00:00:00.000Z",
      },
    ])
    render(<App />)
    const user = userEvent.setup()
    await user.click(await screen.findByTitle("设置"))
    await user.click(screen.getByText("项目设置"))
    fireEvent.click(await screen.findByRole("button", { name: "删除项目" }))
    fireEvent.click(screen.getByRole("button", { name: "确认删除？" }))
    // 当前选中的是最新项目 p-b
    await waitFor(() => expect(mockedDeleteProject).toHaveBeenCalledWith("p-b"))
    // 回落到剩余第一项
    await waitFor(() => expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0))
  })
})

describe("App creation flows", () => {
  afterEach(() => vi.clearAllMocks())

  it("creates a project via switcher menu and switches to it", async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByTestId("project-switcher"))
    await user.click(screen.getByText("新建项目"))
    fireEvent.change(screen.getByPlaceholderText(/例如：Octopus Platform/), {
      target: { value: "Merchant Portal" },
    })
    await user.click(screen.getByRole("button", { name: "创建项目" }))
    // 自动切换到新项目
    expect(screen.getByText("未排期")).toBeInTheDocument()
    // 切换器列表中出现新项目
    await user.click(screen.getByTestId("project-switcher"))
    expect(screen.getAllByText("Merchant Portal").length).toBeGreaterThan(0)
  })

  it("creates a requirement via strip button and shows it in drawer", async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole("button", { name: /新建需求/ }))
    fireEvent.change(screen.getByPlaceholderText(/多租户权限体系升级/), {
      target: { value: "品牌全新的需求条目" },
    })
    await user.click(screen.getByRole("button", { name: "创建需求" }))

    await user.click(screen.getAllByRole("button", { name: /需求池/ })[0])
    expect(await screen.findByText("品牌全新的需求条目")).toBeInTheDocument()
  })

  it("creates a task via kanban drawer and shows it in 待处理", async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole("button", { name: /任务看板/ }))
    await user.click(await screen.findByRole("button", { name: /新建任务/ }))
    fireEvent.change(screen.getByPlaceholderText(/导出报表支持 CSV/), {
      target: { value: "看板里冒出来的新任务" },
    })
    await user.click(screen.getByRole("button", { name: "创建任务" }))
    expect(await screen.findByText("看板里冒出来的新任务")).toBeInTheDocument()
  })
})