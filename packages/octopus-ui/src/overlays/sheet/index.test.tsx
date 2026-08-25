import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { Sheet } from "./index"

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(true)
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) onClose?.()
      }}
      title="任务看板"
      subtitle="Octopus Platform · 迭代 4.2"
    >
      <div>面板内容</div>
    </Sheet>
  )
}

describe("Sheet", () => {
  it("renders title/subtitle/content when open", () => {
    render(<Harness />)
    expect(screen.getByRole("heading", { name: "任务看板" })).toBeInTheDocument()
    expect(screen.getByText("面板内容")).toBeInTheDocument()
  })

  it("closes via close button (aria-label=关闭)", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await user.click(screen.getByRole("button", { name: "关闭" }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("backdrop click closes and overlay exposes testid", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { baseElement } = render(<Harness onClose={onClose} />)
    const backdrop = baseElement.querySelector('[data-testid="drawer-backdrop"]')
    expect(backdrop).not.toBeNull()
    await user.click(backdrop!)
    expect(onClose).toHaveBeenCalledOnce()
  })
})
