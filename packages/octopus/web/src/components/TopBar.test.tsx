import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { PROJECTS } from "../lib/datasource"
import { TopBar } from "./TopBar"

const me = {
  user: { id: "1", username: "boss", role: "admin" as const },
  canLogout: true,
}

const props = {
  projects: PROJECTS,
  currentProjectId: "octopus-platform",
  onSwitchProject: vi.fn(),
  onOpenNewProject: vi.fn(),
  me,
  onLogout: vi.fn(),
}

describe("TopBar", () => {
  it("renders brand and current project in switcher", () => {
    render(<TopBar {...props} />)
    expect(screen.getAllByText("Octopus Platform").length).toBeGreaterThan(0)
    expect(screen.getByText("迭代 4.2 · 第 2 周")).toBeInTheDocument()
  })

  it("switcher lists projects and switches", async () => {
    const user = userEvent.setup()
    render(<TopBar {...props} />)
    await user.click(screen.getByTestId("project-switcher"))
    expect(screen.getByText("Merchant Portal")).toBeInTheDocument()
    await user.click(screen.getByText("Data Core"))
    expect(props.onSwitchProject).toHaveBeenCalledWith("data-core")
  })

  it("settings menu keeps main-interface link only (dead links removed)", async () => {
    const user = userEvent.setup()
    render(<TopBar {...props} />)
    await user.click(screen.getByLabelText("设置"))
    const link = screen.getByRole("link", { name: "进入主界面" })
    expect(link).toHaveAttribute("href", "/")
    // dsh-web-frontend 无 /marketplace、/settings 路由，旧首页链接为死链，不保留
    expect(screen.queryByRole("link", { name: "插件市场" })).not.toBeInTheDocument()
  })

  it("shows 用户管理 under 全局 only when onOpenUserManagement provided", async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<TopBar {...props} onOpenUserManagement={onOpen} />)
    await user.click(screen.getByLabelText("设置"))
    await user.click(await screen.findByText("用户管理"))
    expect(onOpen).toHaveBeenCalled()
  })

  it("hides 用户管理 when onOpenUserManagement is not provided", async () => {
    const user = userEvent.setup()
    render(<TopBar {...props} />)
    await user.click(screen.getByLabelText("设置"))
    expect(screen.queryByText("用户管理")).not.toBeInTheDocument()
  })

  it("user menu shows username and role, logout calls onLogout when canLogout", async () => {
    const user = userEvent.setup()
    render(<TopBar {...props} />)
    expect(screen.getByLabelText("用户菜单")).toHaveTextContent("BO")
    await user.click(screen.getByLabelText("用户菜单"))
    expect(screen.getByText("boss")).toBeInTheDocument()
    expect(screen.getByText("管理员")).toBeInTheDocument()
    await user.click(screen.getByText("退出"))
    expect(props.onLogout).toHaveBeenCalled()
  })

  it("hides logout item when canLogout is false", async () => {
    const user = userEvent.setup()
    render(<TopBar {...props} me={{ ...me, canLogout: false }} />)
    await user.click(screen.getByLabelText("用户菜单"))
    expect(screen.queryByText("退出")).not.toBeInTheDocument()
  })
})
