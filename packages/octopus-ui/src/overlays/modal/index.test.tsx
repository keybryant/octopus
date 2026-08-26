import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { Modal } from "./index"

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(true)
  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) onClose?.()
      }}
      title="新建项目"
      description="创建一个新的项目工作区"
    >
      <div>表单内容</div>
    </Modal>
  )
}

describe("Modal", () => {
  it("renders title, description and content when open", () => {
    render(<Harness />)
    expect(screen.getByRole("heading", { name: "新建项目" })).toBeInTheDocument()
    expect(screen.getByText("创建一个新的项目工作区")).toBeInTheDocument()
    expect(screen.getByText("表单内容")).toBeInTheDocument()
  })

  it("closes via close button", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await user.click(screen.getByRole("button", { name: "关闭" }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("closes via Escape", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("closes via backdrop click", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { baseElement } = render(<Harness onClose={onClose} />)
    const backdrop = baseElement.querySelector('[data-testid="modal-backdrop"]')
    expect(backdrop).not.toBeNull()
    await user.click(backdrop!)
    expect(onClose).toHaveBeenCalledOnce()
  })
})
