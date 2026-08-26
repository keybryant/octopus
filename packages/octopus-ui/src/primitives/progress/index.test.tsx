import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ProgressBar } from "./index"

describe("ProgressBar", () => {
  it("exposes aria values and clamps to 0..100", () => {
    render(<ProgressBar value={78} data-testid="p" />)
    const p = screen.getByRole("progressbar")
    expect(p.getAttribute("aria-valuenow")).toBe("78")
    expect(p.querySelector("div")?.getAttribute("style")).toContain("width: 78%")
  })

  it("clamps overflow beyond max", () => {
    render(<ProgressBar value={200} />)
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100")
  })
})
