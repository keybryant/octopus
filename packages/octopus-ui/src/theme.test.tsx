import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ThemeProvider, useTheme } from "./theme"

function Probe() {
  const { mode, setMode } = useTheme()
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <button onClick={() => setMode("light")}>to-light</button>
      <button onClick={() => setMode("dark")}>to-dark</button>
    </div>
  )
}

function mount(props: { defaultMode?: "light" | "dark" } = {}) {
  return render(
    <ThemeProvider {...props}>
      <Probe />
    </ThemeProvider>,
  )
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute("data-mode")
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    document.documentElement.removeAttribute("data-mode")
  })

  it("applies defaultMode dark to <html data-mode>", () => {
    mount({ defaultMode: "dark" })
    expect(document.documentElement.dataset.mode).toBe("dark")
    expect(screen.getByTestId("mode")).toHaveTextContent("dark")
  })

  it("setMode persists to localStorage and updates attribute", () => {
    mount({ defaultMode: "dark" })
    fireEvent.click(screen.getByText("to-light"))
    expect(document.documentElement.dataset.mode).toBe("light")
    expect(localStorage.getItem("octopus-ui-mode")).toBe("light")
    expect(screen.getByTestId("mode")).toHaveTextContent("light")
  })

  it("stored preference wins over defaultMode", () => {
    localStorage.setItem("octopus-ui-mode", "light")
    mount({ defaultMode: "dark" })
    expect(document.documentElement.dataset.mode).toBe("light")
  })

  it("follows system preference when no defaultMode and nothing stored", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("dark"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    mount()
    expect(document.documentElement.dataset.mode).toBe("dark")
  })
})
