import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Avatar } from "./index"

describe("Avatar", () => {
  it("renders initials with accessible label", () => {
    render(<Avatar initials="ZS" data-testid="a" />)
    expect(screen.getByLabelText("ZS")).toHaveTextContent("ZS")
  })
})
