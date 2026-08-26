import { render, screen, waitFor } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import App from "./App"
import { fetchConfig, fetchModules } from "./api"

vi.mock("./api", () => ({
  fetchConfig: vi.fn().mockResolvedValue(null),
  fetchModules: vi.fn().mockResolvedValue([]),
}))
const mockedFetchConfig = vi.mocked(fetchConfig)
const mockedFetchModules = vi.mocked(fetchModules)

describe("App (v5 agent homepage)", () => {
  afterEach(() => {
    vi.clearAllMocks()
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

  it("modules drawer keeps lazy-load chain alive (entry via settings menu)", async () => {
    mockedFetchModules.mockResolvedValue([
      { id: "quickstart", title: "快捷入口", entry: "/octopus/quickstart/assets/index.js" },
    ])
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByLabelText("设置"))
    await user.click(screen.getByText("已装模块"))
    expect(await screen.findByRole("button", { name: "快捷入口" })).toBeInTheDocument()
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
})
