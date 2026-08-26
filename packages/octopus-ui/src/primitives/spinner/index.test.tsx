import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Spinner } from "./index"

describe("Spinner", () => {
  it("renders with status role and spin animation", () => {
    const { container } = render(<Spinner />)
    expect(container.querySelector('[role="status"]')).not.toBeNull()
    expect(container.querySelector(".animate-spin")).not.toBeNull()
  })
})
