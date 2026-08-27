import { render, screen, waitFor } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { OCTOPUS_DECOMPOSE_EVENT } from "octopus-ui"
import App from "./App"
import { createProject, deleteProject, fetchConfig, fetchModules, fetchProjects, updateProject } from "./api"
import { fetchMe, redirectToLogin } from "./lib/auth"

vi.mock("./api", () => ({
  fetchConfig: vi.fn().mockResolvedValue(null),
  fetchModules: vi.fn().mockResolvedValue([]),
  fetchProjects: vi.fn().mockResolvedValue(null), // 无数据 → 空列表
  createProject: vi.fn(),
  updateProject: vi.fn().mockResolvedValue(true),
  deleteProject: vi.fn().mockResolvedValue(true),
}))
const mockedFetchConfig = vi.mocked(fetchConfig)
const mockedFetchModules = vi.mocked(fetchModules)
const mockedFetchProjects = vi.mocked(fetchProjects)
const mockedCreateProject = vi.mocked(createProject)
const mockedUpdateProject = vi.mocked(updateProject)
const mockedDeleteProject = vi.mocked(deleteProject)

const apiProject = {
  id: "p-api",
  name: "API Project",
  description: "",
  status: "active" as const,
  workspacePath: "~/r/API Project",
  workspaceId: "w",
  createdAt: "2026-08-26T00:00:00.000Z",
}

vi.mock("./lib/auth", () => ({
  fetchMe: vi.fn().mockResolvedValue({
    user: { id: "1", username: "boss", role: "admin" },
    canLogout: true,
  }),
  redirectToLogin: vi.fn(),
  logout: vi.fn(),
}))
const mockedFetchMe = vi.mocked(fetchMe)
const mockedRedirectToLogin = vi.mocked(redirectToLogin)

// App 在 fetchMe 落定前不渲染任何受保护内容，故先等待身份检查完成
async function renderApp() {
  const utils = render(<App />)
  await waitFor(() => expect(mockedFetchMe).toHaveBeenCalled())
  return utils
}

describe("App (v5 agent homepage)", () => {
  afterEach(() => {
    vi.clearAllMocks()
    mockedFetchProjects.mockResolvedValue(null)
  })

  it("renders empty project state when no projects", async () => {
    await renderApp()
    // 无数据 → 空列表：切换器显示无项目，主区空状态，聊天/看板等全部隐藏
    expect(screen.getByText("无项目")).toBeInTheDocument()
    expect(screen.getByText("暂无项目")).toBeInTheDocument()
    expect(screen.queryByText(/当前上下文/)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /任务看板/ })).not.toBeInTheDocument()
    expect(mockedFetchConfig).toHaveBeenCalled()
    expect(mockedFetchMe).toHaveBeenCalled()
  })

  it("redirects to login and renders nothing when unauthorized", async () => {
    mockedFetchMe.mockRejectedValueOnce(new Error("unauthorized"))
    const { container } = await renderApp()
    await waitFor(() => expect(mockedRedirectToLogin).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it("admin opens 用户管理 from 设置 → 全局", async () => {
    const user = userEvent.setup()
    mockedFetchModules.mockResolvedValueOnce([
      { id: "users-view", title: "用户管理", entry: "/octopus/users-view/assets/index.js" },
    ])
    await renderApp()
    await user.click(screen.getByLabelText("设置"))
    await user.click(await screen.findByText("用户管理"))
    expect(await screen.findByRole("heading", { name: "用户管理" })).toBeInTheDocument()
  })

  it("opens requirements drawer as a right sheet", async () => {
    mockedFetchProjects.mockResolvedValue([apiProject])
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByRole("button", { name: /需求看板/ }))
    expect(await screen.findByRole("heading", { name: "需求看板" })).toBeInTheDocument()
    // Esc 关闭后回到 agent 视图
    fireEvent.keyDown(document, { key: "Escape" })
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "需求看板" })).not.toBeInTheDocument(),
    )
  })

  it("opens kanban drawer from strip and closes on Esc", async () => {
    mockedFetchProjects.mockResolvedValue([apiProject])
    const user = userEvent.setup()
    await renderApp()
    await user.click(await screen.findByRole("button", { name: /任务看板/ }))
    expect(await screen.findByRole("heading", { name: "任务看板" })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: "Escape" })
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "任务看板" })).not.toBeInTheDocument(),
    )
  })

  it("chat send round-trip shows assistant cards and artifacts rail", async () => {
    mockedFetchProjects.mockResolvedValue([apiProject])
    const user = userEvent.setup()
    await renderApp()
    const box = await screen.findByPlaceholderText(/给 Octo Agent 下指令/)
    await user.type(box, "列出优先事项")
    fireEvent.keyDown(box, { key: "Enter" })
    expect(await screen.findByText("让 Agent 接手 →")).toBeInTheDocument()
    expect(screen.getByText("本会话产出")).toBeInTheDocument()
  })

  it("artifacts rail collapses and restores", async () => {
    mockedFetchProjects.mockResolvedValue([apiProject])
    const user = userEvent.setup()
    await renderApp()
    await user.click(await screen.findByTitle("收起"))
    expect(screen.queryByText("本会话产出")).not.toBeInTheDocument()
    await user.click(screen.getByTitle("展开产出面板"))
    expect(screen.getByText("本会话产出")).toBeInTheDocument()
  })

  it("project switcher switches current project", async () => {
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
    const user = userEvent.setup()
    await renderApp()
    // 默认选中最新项目 p-b
    await waitFor(() => expect(screen.getAllByText("Beta").length).toBeGreaterThan(0))
    // 切换到 Alpha
    await user.click(screen.getByTestId("project-switcher"))
    await user.click(screen.getByText("Alpha"))
    // 打开项目设置弹窗，确认当前项目已切换为 Alpha（切换器 + 弹窗均显示）
    await user.click(screen.getByTitle("设置"))
    await user.click(screen.getByText("项目设置"))
    expect((await screen.findAllByText("Alpha")).length).toBeGreaterThan(0)
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
    await renderApp()
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
    await renderApp()
    const user = userEvent.setup()
    await user.click(await screen.findByTitle("设置"))
    await user.click(screen.getByText("项目设置"))
    await user.click(await screen.findByText("进行中"))
    await user.click(screen.getByText("已暂停"))
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
    await renderApp()
    const user = userEvent.setup()
    await user.click(await screen.findByTitle("设置"))
    await user.click(screen.getByText("项目设置"))
    fireEvent.click(await screen.findByRole("button", { name: "删除项目" }))
    fireEvent.click(await screen.findByRole("button", { name: "确认删除" }))
    // 当前选中的是最新项目 p-b
    await waitFor(() => expect(mockedDeleteProject).toHaveBeenCalledWith("p-b"))
    // 回落到剩余第一项；被删项目消失
    await waitFor(() => expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0))
    expect(screen.queryByText("Beta")).not.toBeInTheDocument()
  })
})

describe("App creation flows", () => {
  afterEach(() => vi.clearAllMocks())

  it("creates a project via switcher menu and switches to it", async () => {
    mockedCreateProject.mockResolvedValue({
      id: "p-new",
      name: "Merchant Portal",
      description: "",
      status: "active",
      workspacePath: "~/r/MP",
      workspaceId: "w",
      createdAt: "2026-08-27T00:00:00.000Z",
    })
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByTestId("project-switcher"))
    await user.click(screen.getByRole("menuitem", { name: "新建项目" }))
    fireEvent.change(screen.getByPlaceholderText(/例如：Octopus Platform/), {
      target: { value: "Merchant Portal" },
    })
    await user.click(screen.getByRole("button", { name: "创建项目" }))
    // 走真实 POST
    expect(mockedCreateProject).toHaveBeenCalledWith({ name: "Merchant Portal", description: "" })
    // 自动切换到新项目：项目条出现
    expect(await screen.findByText("本周任务")).toBeInTheDocument()
    // 切换器列表中出现新项目
    await user.click(screen.getByTestId("project-switcher"))
    expect(screen.getAllByText("Merchant Portal").length).toBeGreaterThan(0)
  })

  it("decompose bridge event opens tasks drawer with payload", async () => {
    mockedFetchProjects.mockResolvedValue([apiProject])
    const user = userEvent.setup()
    await renderApp()
    // 先收载荷进内存，再派发事件
    window.dispatchEvent(
      new CustomEvent(OCTOPUS_DECOMPOSE_EVENT, {
        detail: { requirementId: "REQ-100", title: "OAuth 2.0 重构", priority: "P0" },
      }),
    )
    await waitFor(() =>
      expect((window as unknown as { __octopusDecomposePayload?: unknown }).__octopusDecomposePayload).toMatchObject({
        requirementId: "REQ-100",
      }),
    )
    expect(await screen.findByRole("heading", { name: "任务看板" })).toBeInTheDocument()
    const holder = window as unknown as { __octopusDecomposePayload?: unknown }
    delete holder.__octopusDecomposePayload
  })
})
