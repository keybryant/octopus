import { render, screen } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { Button } from "./index"

describe("Button", () => {
  it("renders children and handles clicks", () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>保存</Button>)
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it("defaults to secondary variant and md size classes", () => {
    render(<Button data-testid="btn">x</Button>)
    const btn = screen.getByTestId("btn")
    expect(btn.className).toContain("border-border")
    expect(btn.className).toContain("rounded-lg")
  })

  it("primary variant uses accent tokens", () => {
    render(<Button variant="primary" data-testid="btn">x</Button>)
    expect(screen.getByTestId("btn").className).toContain("bg-accent")
  })

  it("sm size uses small radius/height", () => {
    render(<Button size="sm" data-testid="btn">x</Button>)
    expect(screen.getByTestId("btn").className).toContain("rounded-sm")
  })
})
