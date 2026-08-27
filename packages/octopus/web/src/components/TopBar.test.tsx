import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { PROJECTS } from "../lib/datasource"
import { TopBar } from "./TopBar"

const props = {
  projects: PROJECTS,
  currentProjectId: "octopus-platform",
  onSwitchProject: vi.fn(),
  onOpenNewProject: vi.fn(),
  onOpenProjectSettings: vi.fn(),
}

describe("TopBar", () => {
  it("renders brand and current project in switcher", () => {
    render(<TopBar {...props} />)
    expect(screen.getAllByText("Octopus Platform").length).toBeGreaterThan(0)
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

  it("opens project settings from the settings menu", async () => {
    const user = userEvent.setup()
    render(<TopBar {...props} />)
    await user.click(screen.getByTitle("设置"))
    await user.click(screen.getByText("项目设置"))
    expect(props.onOpenProjectSettings).toHaveBeenCalledOnce()
  })

  it("with no projects shows 无项目 and hides project settings group", async () => {
    const user = userEvent.setup()
    render(<TopBar {...props} projects={[]} currentProjectId={undefined} />)
    expect(screen.getByText("无项目")).toBeInTheDocument()
    await user.click(screen.getByTitle("设置"))
    expect(screen.queryByText("项目设置")).not.toBeInTheDocument()
    expect(screen.queryByText("成员与权限")).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "进入主界面" })).toBeInTheDocument()
  })
})
