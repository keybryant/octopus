import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Card } from "./index"

describe("Card", () => {
  it("renders with surface tokens and merges className", () => {
    render(<Card data-testid="c" className="p-4">内容</Card>)
    const c = screen.getByTestId("c")
    expect(c.className).toContain("bg-surface")
    expect(c.className).toContain("p-4")
  })
})
