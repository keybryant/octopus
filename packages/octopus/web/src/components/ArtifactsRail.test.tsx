import { render, screen } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { INITIAL_ARTIFACTS } from "../lib/datasource"
import { ArtifactsRail } from "./ArtifactsRail"

const base = {
  artifacts: INITIAL_ARTIFACTS,
  onCollapse: vi.fn(),
  onExpand: vi.fn(),
}

describe("ArtifactsRail", () => {
  it("groups artifacts by kind with live indicator", () => {
    render(<ArtifactsRail {...base} collapsed={false} />)
    expect(screen.getByText("本会话产出")).toBeInTheDocument()
    expect(screen.getByText("TASK-2850 转 Agent 执行")).toBeInTheDocument()
    expect(screen.getByText("赶工方案草案.md")).toBeInTheDocument()
    expect(screen.getByTestId("artifact-live-dot")).toBeInTheDocument()
  })

  it("collapses to restore button and back", () => {
    const { rerender } = render(<ArtifactsRail {...base} collapsed={false} />)
    fireEvent.click(screen.getByTitle("收起"))
    expect(base.onCollapse).toHaveBeenCalledOnce()

    rerender(<ArtifactsRail {...base} collapsed />)
    expect(screen.queryByText("本会话产出")).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle("展开产出面板"))
    expect(base.onExpand).toHaveBeenCalledOnce()
  })
})
