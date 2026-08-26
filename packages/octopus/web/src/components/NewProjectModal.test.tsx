import { render, screen } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { NewProjectModal } from "./NewProjectModal"
import { deriveShortName } from "../lib/short-name"

interface Payload {
  name: string
  description: string
}

describe("deriveShortName", () => {
  it("takes first character for Chinese names", () => {
    expect(deriveShortName("章鱼工作台")).toBe("章")
    expect(deriveShortName("数据中台")).toBe("数")
  })
  it("takes initials of first two English words", () => {
    expect(deriveShortName("Octopus Platform")).toBe("OP")
    expect(deriveShortName("Merchant Portal")).toBe("MP")
  })
  it("falls back to first two letters for single English word", () => {
    expect(deriveShortName("Octopus")).toBe("OC")
  })
})

describe("NewProjectModal", () => {
  const NAME_PLACEHOLDER = /例如：Octopus Platform/

  function mount(handlers: { onCreate: (d: Payload) => void; onClose?: () => void }) {
    return render(
      <NewProjectModal open onClose={handlers.onClose ?? (() => {})} onCreate={handlers.onCreate} />,
    )
  }

  function fill(payload: Partial<Payload>) {
    if (payload.name !== undefined)
      fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
        target: { value: payload.name },
      })
    if (payload.description !== undefined)
      fireEvent.change(screen.getByPlaceholderText(/一句话说明项目目标/), {
        target: { value: payload.description },
      })
  }

  it("shows avatar preview derived from name (no shortName input)", () => {
    mount({ onCreate: vi.fn() })
    // 没有缩写输入框
    expect(screen.queryByPlaceholderText(/留空自动生成|两字符/)).not.toBeInTheDocument()
    fill({ name: "Merchant Portal" })
    // 预览头像显示推导字符 MP
    expect(screen.getByLabelText("MP")).toBeInTheDocument()
  })

  it("disables submit until name is filled", () => {
    mount({ onCreate: vi.fn() })
    expect(screen.getByRole("button", { name: "创建项目" })).toBeDisabled()
    fill({ name: "章鱼工作台" })
    expect(screen.getByRole("button", { name: "创建项目" })).not.toBeDisabled()
  })

  it("submits name+description payload and closes", () => {
    const onClose = vi.fn()
    const onCreate = vi.fn((_d: Payload) => {})
    mount({ onCreate, onClose })

    fill({ name: "数据中台", description: "指标统一服务" })
    fireEvent.click(screen.getByRole("button", { name: "创建项目" }))

    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onCreate).toHaveBeenCalledWith({
      name: "数据中台",
      description: "指标统一服务",
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("closes via cancel without calling onCreate", () => {
    const onClose = vi.fn()
    const onCreate = vi.fn((_d: Payload) => {})
    mount({ onCreate, onClose })
    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onCreate).not.toHaveBeenCalled()
  })
})
