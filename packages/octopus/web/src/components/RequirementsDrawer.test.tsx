import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { REQUIREMENTS } from "../lib/datasource"
import { RequirementsDrawer } from "./RequirementsDrawer"

describe("RequirementsDrawer", () => {
  it("renders requirement rows with status and progress", () => {
    const onClose = vi.fn()
    render(<RequirementsDrawer open onClose={onClose} requirements={REQUIREMENTS} />)
    expect(screen.getByRole("heading", { name: "需求池" })).toBeInTheDocument()
    expect(screen.getByText(/REQ-118/)).toBeInTheDocument()
    expect(screen.getByText("多租户权限体系升级")).toBeInTheDocument()
    expect(screen.getByText("开发中")).toBeInTheDocument()
    expect(screen.getByText("未分配")).toBeInTheDocument()
  })

  it("shows count and empty hint", () => {
    render(<RequirementsDrawer open onClose={() => {}} requirements={[]} />)
    expect(screen.getByText("Octopus Platform · 0 个需求")).toBeInTheDocument()
    expect(screen.getByText("需求池为空")).toBeInTheDocument()
  })

  it("newly created requirement appears at top", () => {
    const rows = [
      { id: "REQ-200", title: "全新需求", statusBadge: { label: "待排期", tone: "orange" as const }, owner: null, progressPct: 0 },
      ...REQUIREMENTS,
    ]
    render(<RequirementsDrawer open onClose={() => {}} requirements={rows} />)
    const firstId = screen.getAllByText(/REQ-\d+/)[0]
    expect(firstId).toHaveTextContent("REQ-200")
    expect(screen.getByText("全新需求")).toBeInTheDocument()
  })
})
