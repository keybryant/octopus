import { render, screen } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { KanbanTask } from "../lib/types"
import { KANBAN_COLUMNS } from "../lib/datasource"
import { KanbanDrawer } from "./KanbanDrawer"

describe("KanbanDrawer", () => {
  const base = {
    open: true,
    onClose: () => {},
    columns: KANBAN_COLUMNS,
    onCreateTask: vi.fn((_t: KanbanTask) => {}),
  }

  it("renders nothing when closed, board when open", () => {
    const { rerender } = render(<KanbanDrawer {...base} open={false} />)
    expect(screen.queryByRole("heading", { name: "任务看板" })).not.toBeInTheDocument()
    rerender(<KanbanDrawer {...base} open />)
    expect(screen.getByRole("heading", { name: "任务看板" })).toBeInTheDocument()
    expect(screen.getByText("待处理")).toBeInTheDocument()
    expect(screen.getByText("评审中")).toBeInTheDocument()
    expect(screen.getByText(/TASK-2841/)).toBeInTheDocument()
    expect(screen.getByText(/Agent 执行中/)).toBeInTheDocument()
    // 列计数来自传入数据
    expect(screen.getAllByText("待处理").length).toBeGreaterThan(0)
  })

  it("closes via close button", () => {
    const onClose = vi.fn()
    render(<KanbanDrawer {...base} onClose={onClose} />)
    fireEvent.click(screen.getByRole("button", { name: "关闭" }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("closes via backdrop click", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { baseElement } = render(<KanbanDrawer {...base} onClose={onClose} />)
    const backdrop = baseElement.querySelector('[data-testid="drawer-backdrop"]')
    expect(backdrop).not.toBeNull()
    await user.click(backdrop!)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("closes via Escape", () => {
    const onClose = vi.fn()
    render(<KanbanDrawer {...base} onClose={onClose} />)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("creates a task via the new-task modal into 待处理 column", async () => {
    const user = userEvent.setup()
    const onCreateTask = vi.fn((_t: KanbanTask) => {})
    render(<KanbanDrawer {...base} onCreateTask={onCreateTask} />)

    await user.click(screen.getByRole("button", { name: /新建任务/ }))
    fireEvent.change(screen.getByPlaceholderText(/导出报表支持 CSV/), {
      target: { value: "品牌全新的任务" },
    })
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }))

    expect(onCreateTask).toHaveBeenCalledTimes(1)
    const task = onCreateTask.mock.calls[0][0] as KanbanTask
    expect(task.title).toBe("品牌全新的任务")
    expect(task.column).toBe("todo")
    expect(task.id).toMatch(/^TASK-\d+$/)
    expect(Number(task.id.replace("TASK-", ""))).toBeGreaterThan(2856)
  })
})
