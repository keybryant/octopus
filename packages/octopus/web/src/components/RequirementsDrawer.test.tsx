import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { REQUIREMENTS } from "../lib/datasource"
import { RequirementsDrawer } from "./RequirementsDrawer"

describe("RequirementsDrawer", () => {
  it("renders requirement rows with status and progress", () => {
    const onClose = vi.fn()
    render(<RequirementsDrawer open onClose={onClose} />)
    expect(screen.getByRole("heading", { name: "需求池" })).toBeInTheDocument()
    expect(screen.getByText(/REQ-118/)).toBeInTheDocument()
    expect(screen.getByText("多租户权限体系升级")).toBeInTheDocument()
    expect(screen.getByText("开发中")).toBeInTheDocument()
    expect(screen.getByText("未分配")).toBeInTheDocument()
  })
})
