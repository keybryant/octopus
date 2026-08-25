import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Badge } from "./index"

describe("Badge", () => {
  it("renders children with default neutral tone", () => {
    render(<Badge data-testid="b">进行中</Badge>)
    const b = screen.getByTestId("b")
    expect(b).toHaveTextContent("进行中")
    expect(b.className).toContain("text-muted-foreground")
  })

  it("maps tones to semantic color classes", () => {
    render(<Badge tone="success">s</Badge>)
    expect(screen.getByText("s").className).toContain("text-accent")
  })
})
