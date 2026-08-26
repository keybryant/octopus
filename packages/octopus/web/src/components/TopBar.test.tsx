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
})
