import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import App from "./App"
import { fetchConfig } from "./api"
import { timeGreeting } from "./greeting"

vi.mock("./api", () => ({
  fetchConfig: vi.fn(),
  fetchModules: vi.fn(),
}))

const mockedFetchConfig = vi.mocked(fetchConfig)

describe("App", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1, 9, 0, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it("renders default title and time greeting when config fails", async () => {
    mockedFetchConfig.mockResolvedValue(null)
    render(<App />)
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("My Workbench")
    expect(screen.getByText("早上好")).toBeInTheDocument()
  })

  it("uses config title and greeting when provided", async () => {
    mockedFetchConfig.mockResolvedValue({ title: "我的工作台", greeting: "欢迎回来" })
    render(<App />)
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("我的工作台")
    expect(screen.getByText("欢迎回来")).toBeInTheDocument()
  })

  it("renders quick links", () => {
    render(<App />)
    expect(screen.getByRole("link", { name: "进入主界面" })).toHaveAttribute("href", "/")
    expect(screen.getByRole("link", { name: "插件市场" })).toHaveAttribute("href", "/marketplace")
    expect(screen.getByRole("link", { name: "设置" })).toHaveAttribute("href", "/settings")
  })
})

describe("timeGreeting", () => {
  it("greets by hour ranges", () => {
    expect(timeGreeting(7)).toBe("早上好")
    expect(timeGreeting(12)).toBe("中午好")
    expect(timeGreeting(15)).toBe("下午好")
    expect(timeGreeting(22)).toBe("晚上好")
    expect(timeGreeting(3)).toBe("晚上好")
  })
})
