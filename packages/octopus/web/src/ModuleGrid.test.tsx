import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import ModuleGrid from "./ModuleGrid"
import { loadModule } from "./loadModule"

vi.mock("./loadModule", () => ({
  loadModule: vi.fn(),
}))

const mockedLoadModule = vi.mocked(loadModule)

describe("ModuleGrid", () => {
  it("renders nothing when there are no modules", () => {
    const { container } = render(<ModuleGrid modules={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders a card per module and lazy-loads its bundle on click", async () => {
    const Comp = () => <div>已加载</div>
    mockedLoadModule.mockResolvedValue({ default: Comp })
    render(<ModuleGrid modules={[{ id: "quickstart", title: "快捷入口", entry: "/octopus/quickstart/assets/index.js" }]} />)
    const button = screen.getByRole("button", { name: "快捷入口" })
    expect(button).toBeInTheDocument()
    await userEvent.click(button)
    expect(await screen.findByText("已加载")).toBeInTheDocument()
    expect(mockedLoadModule).toHaveBeenCalledWith("/octopus/quickstart/assets/index.js")
  })

  it("shows an error placeholder when the bundle fails to load", async () => {
    mockedLoadModule.mockRejectedValue(new Error("boom"))
    render(<ModuleGrid modules={[{ id: "quickstart", title: "快捷入口", entry: "/broken.js" }]} />)
    await userEvent.click(screen.getByRole("button", { name: "快捷入口" }))
    expect(await screen.findByText("模块 快捷入口 加载失败")).toBeInTheDocument()
  })
})
