import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { Input, Textarea } from "./index"

describe("Input", () => {
  it("supports controlled input with onChange", () => {
    const onChange = vi.fn()
    render(<Input value="abc" onChange={onChange} />)
    const input = screen.getByDisplayValue("abc")
    expect(input.className).toContain("border-border")
  })
})

describe("Textarea", () => {
  it("renders rows and merges className", () => {
    render(<Textarea data-testid="ta" rows={3} placeholder="输入" className="pt-1" />)
    const ta = screen.getByPlaceholderText("输入") as HTMLTextAreaElement
    expect(ta.rows).toBe(3)
    expect(ta.className).toContain("pt-1")
  })
})
