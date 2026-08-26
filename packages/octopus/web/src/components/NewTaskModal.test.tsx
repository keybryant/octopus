import { render, screen } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { NewTaskModal } from "./NewTaskModal"

interface Payload {
  title: string
  priority: "P0" | "P1" | "P2"
  assignee?: string
}

describe("NewTaskModal", () => {
  const TITLE_PLACEHOLDER = /导出报表支持 CSV/

  function mount(handlers: { onCreate: (d: Payload) => void; onClose?: () => void }) {
    return render(
      <NewTaskModal open onClose={handlers.onClose ?? (() => {})} onCreate={handlers.onCreate} />,
    )
  }

  it("submits title/priority with optional assignee and closes", () => {
    const onClose = vi.fn()
    const onCreate = vi.fn((_d: Payload) => {})
    mount({ onCreate, onClose })

    fireEvent.change(screen.getByPlaceholderText(TITLE_PLACEHOLDER), {
      target: { value: "审计日志查询接口分页优化" },
    })
    fireEvent.click(screen.getByRole("button", { name: /P2/ }))
    fireEvent.change(screen.getByPlaceholderText(/留空则进入待认领池/), {
      target: { value: "王倩" },
    })
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }))

    expect(onCreate).toHaveBeenCalledWith({
      title: "审计日志查询接口分页优化",
      priority: "P2",
      assignee: "王倩",
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("assignee is optional; payload omits empty assignee", () => {
    const onCreate = vi.fn((_d: Payload) => {})
    mount({ onCreate })

    fireEvent.change(screen.getByPlaceholderText(TITLE_PLACEHOLDER), {
      target: { value: "新任务" },
    })
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }))

    expect(onCreate).toHaveBeenCalledWith({
      title: "新任务",
      priority: "P1",
      assignee: undefined,
    })
  })

  it("cancel closes without creating", () => {
    const onClose = vi.fn()
    const onCreate = vi.fn((_d: Payload) => {})
    mount({ onCreate, onClose })
    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onCreate).not.toHaveBeenCalled()
  })
})
