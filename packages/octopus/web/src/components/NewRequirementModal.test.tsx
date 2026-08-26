import { render, screen } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { NewRequirementModal } from "./NewRequirementModal"

interface Payload {
  title: string
  priority: "P0" | "P1" | "P2"
}

describe("NewRequirementModal", () => {
  const TITLE_PLACEHOLDER = /多租户权限体系升级/

  function mount(handlers: { onCreate: (d: Payload) => void; onClose?: () => void }) {
    return render(
      <NewRequirementModal open onClose={handlers.onClose ?? (() => {})} onCreate={handlers.onCreate} />,
    )
  }

  it("defaults to P1 and requires title", () => {
    mount({ onCreate: vi.fn() })
    expect(screen.getByRole("button", { name: "创建需求" })).toBeDisabled()
    // P1 默认高亮
    const p1 = screen.getByRole("button", { name: /P1/ })
    expect(p1.className).toContain("text-info")
  })

  it("submits title with chosen priority and closes", async () => {
    const user = undefined as never
    void user
    const onClose = vi.fn()
    const onCreate = vi.fn((_d: Payload) => {})
    mount({ onCreate, onClose })

    fireEvent.change(screen.getByPlaceholderText(TITLE_PLACEHOLDER), {
      target: { value: "CI 流水线缓存加速" },
    })
    fireEvent.click(screen.getByRole("button", { name: /P0/ }))
    fireEvent.click(screen.getByRole("button", { name: "创建需求" }))

    expect(onCreate).toHaveBeenCalledWith({ title: "CI 流水线缓存加速", priority: "P0" })
    expect(onClose).toHaveBeenCalledOnce()
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
