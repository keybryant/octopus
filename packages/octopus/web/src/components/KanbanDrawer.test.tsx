import { render, screen } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { KanbanDrawer } from "./KanbanDrawer"

describe("KanbanDrawer", () => {
  it("renders nothing when closed, board when open", () => {
    const { rerender } = render(<KanbanDrawer open={false} onClose={() => {}} />)
    expect(screen.queryByRole("heading", { name: "任务看板" })).not.toBeInTheDocument()
    rerender(<KanbanDrawer open onClose={() => {}} />)
    expect(screen.getByRole("heading", { name: "任务看板" })).toBeInTheDocument()
    expect(screen.getByText("待处理")).toBeInTheDocument()
    expect(screen.getByText("评审中")).toBeInTheDocument()
    expect(screen.getByText(/TASK-2841/)).toBeInTheDocument()
    expect(screen.getByText(/Agent 执行中/)).toBeInTheDocument()
  })

  it("closes via close button", () => {
    const onClose = vi.fn()
    render(<KanbanDrawer open onClose={onClose} />)
    fireEvent.click(screen.getByRole("button", { name: "关闭" }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("closes via backdrop click", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { baseElement } = render(<KanbanDrawer open onClose={onClose} />)
    const backdrop = baseElement.querySelector('[data-testid="drawer-backdrop"]')
    expect(backdrop).not.toBeNull()
    await user.click(backdrop!)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("closes via Escape", () => {
    const onClose = vi.fn()
    render(<KanbanDrawer open onClose={onClose} />)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
